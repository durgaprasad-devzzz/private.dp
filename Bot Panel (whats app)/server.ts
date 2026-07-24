import express from "express";
import { createServer as createViteServer } from "vite";
import http from "http";
import path from "path";
import bodyParser from "body-parser";
import { Server } from "socket.io";
import qrcode from "qrcode";
import { GoogleGenAI } from "@google/genai";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, Timestamp, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import firebaseConfig from "./firebase-applet-config.json";
import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState, 
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import fs from "fs";
import { useFirestoreAuthState, clearFirestoreAuthState } from "./firebaseAuthState";

const app = express();
const PORT = parseInt(process.env.PORT || "3000");
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(bodyParser.json());

// Debug logging helper
try {
  fs.writeFileSync("server_debug.log", `[${new Date().toISOString()}] Server log initialized.\n`);
} catch (e) {
  console.error("Failed to initialize server_debug.log:", e);
}

function logDebug(message: string) {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync("server_debug.log", `[${timestamp}] ${message}\n`);
    console.log(message);
  } catch (e) {
    console.error("Failed to write to debug log:", e);
  }
}

const DEFAULT_PERSONALITY = `You are a close personal friend chatting on WhatsApp. You have an introverted personality — calm, low-key, doesn't talk too much, but genuine and caring when it matters.

STYLE:
- Keep replies short and simple — most messages should be 1 line, sometimes just 1-3 words ("ok ra", "hmm", "sare", "nice", "ha correct").
- Don't be funny or joke in every message. Humor should show up occasionally, not constantly — an introvert doesn't perform, they respond naturally.
- Avoid long explanations unless the topic genuinely needs it or they ask something that requires detail — then answer clearly and smartly, showing you actually know the subject.
- Don't ask a question in every reply. Most replies are just statements or reactions. Ask something only occasionally, when genuinely curious.
- No excessive emojis — use rarely, only when it feels natural.
- Speak like someone who thinks before typing — calm, a little reserved, not over-enthusiastic.

SMART RESPONSES:
- When asked something factual, technical, or that needs real thought — give a clear, accurate, well-reasoned answer. Being introverted doesn't mean being clueless — be sharp and precise when the topic calls for it.
- Don't fake excitement or drama. React genuinely — calm when calm, serious when serious.

EMOTIONAL AWARENESS:
- If they're upset or venting, listen first, respond with care, don't joke.
- If they're casual/bored, keep it low-key, don't overdo enthusiasm.
- If asked directly "are you AI/bot?", answer honestly — don't deny it.

FORMATTING RULES:
- NEVER use quotation marks ("") around words or phrases in your replies — real people don't type like that in casual WhatsApp chats.
- Keep each reply focused on ONE single thought or question — do not combine multiple questions or options in one message (e.g. don't say "emaina movie chustunnava, leda em pani chestunnava" — pick just one).
- Avoid listing multiple options in a single reply. If you're curious, ask just one simple thing.
- Keep messages SHORT — 1 line ideally, max 2 short lines. No exceptions.
- Write like a normal text message, not like a formatted answer.`;

function getDelay(replyText: string): number {
  const baseDelay = Math.random() * (15 - 5) + 5; // 5 to 15 seconds random base delay
  const typingTime = replyText.length * 0.08;     // 0.08 seconds per character
  const totalDelaySeconds = Math.min(baseDelay + typingTime, 25); // Cap at 25 seconds maximum
  return totalDelaySeconds * 1000; // Convert to milliseconds
}

// Extract message text from various Baileys/WhatsApp message structures
function getMessageText(message: any): string {
  if (!message) return "";
  
  // Handle Ephemeral / View Once messages / Document wrappers
  if (message.ephemeralMessage) {
    return getMessageText(message.ephemeralMessage.message);
  }
  if (message.viewOnceMessage) {
    return getMessageText(message.viewOnceMessage.message);
  }
  if (message.viewOnceMessageV2) {
    return getMessageText(message.viewOnceMessageV2.message);
  }
  if (message.documentWithCaptionMessage) {
    return getMessageText(message.documentWithCaptionMessage.message);
  }

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ""
  );
}

logDebug("Starting server environment...");

// Firebase Initialization (Server-side)
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(firebaseApp);

// Removed authenticateServer to bypass operation-not-allowed issues
logDebug("Firebase Firestore initialized.");

// Baileys Setup
const logger = pino({ level: "silent" });
// store is removed for simplicity and compatibility
let sock: any;
let isStarting = false;
let qrCode: string | null = null;
let connectionStatus: "connecting" | "open" | "close" | "pairing" = "close";

function clearAuthDir() {
  clearFirestoreAuthState(db, "whatsapp_auth").catch(err => console.error("Error clearing firestore auth:", err));
}

async function connectToWhatsApp() {
  if (isStarting) return;
  isStarting = true;
  
  try {
    const { state, saveCreds } = await useFirestoreAuthState(db, "whatsapp_auth");
    const { version } = await fetchLatestBaileysVersion();

    if (sock) {
      sock.ev.removeAllListeners("connection.update");
      sock.ev.removeAllListeners("creds.update");
      sock.ev.removeAllListeners("messages.upsert");
    }

    const currentSock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: state,
      logger,
      browser: ["WhatsApp Bot", "Chrome", "1.0.0"],
    });

    sock = currentSock;

    currentSock.ev.on("creds.update", saveCreds);

    currentSock.ev.on("connection.update", async (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logDebug("Received QR code from Baileys.");
        qrCode = await qrcode.toDataURL(qr);
        connectionStatus = "connecting";
        io.emit("whatsapp:qr", qrCode);
        io.emit("whatsapp:status", "connecting");
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        let reconnectDelay = 5000;
        let shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        
        const errorStr = String(lastDisconnect?.error || "");
        if (errorStr.includes("conflict") || errorStr.includes("Stream Errored") || statusCode === 401) {
          // If it is just a stream conflict or temporary 401 stream error, attempt reconnection with a 10s backoff
          if (errorStr.includes("conflict") || errorStr.includes("Stream Errored")) {
            logDebug("Detected stream conflict. Will attempt to reconnect in 10 seconds...");
            shouldReconnect = true;
            reconnectDelay = 10000;
          }
        }

        // If the QR code expired because nobody scanned it, do NOT auto-reconnect endlessly.
        // This stops the background loop and lets the user connect manually from the dashboard.
        if (statusCode === 408 || errorStr.includes("QR refs attempts ended")) {
          logDebug("QR code expired or attempts ended. Stopping automatic reconnection to prevent loops.");
          shouldReconnect = false;
        }

        if (statusCode === 408 || errorStr.includes("QR refs attempts ended")) {
          logDebug("Connection closed gracefully. StatusCode: 408. QR session ended since code was not scanned.");
        } else {
          logDebug(`Connection closed. StatusCode: ${statusCode}. Reconnecting: ${shouldReconnect}. Details: ${lastDisconnect?.error || "none"}`);
        }
        connectionStatus = "close";
        io.emit("whatsapp:status", "disconnected");
        qrCode = null;
        isStarting = false;

        // Clear auth directory on explicit logout, QR expire/timeout (408), or specific error
        if (statusCode === DisconnectReason.loggedOut || statusCode === 408 || errorStr.includes("QR refs attempts ended")) {
          logDebug("Clearing auth credentials because of logout or QR timeout...");
          clearAuthDir();
        }

        if (shouldReconnect) {
          logDebug(`Scheduling reconnection in ${reconnectDelay / 1000} seconds...`);
          setTimeout(connectToWhatsApp, reconnectDelay); // Delay to prevent spam
        }
      } else if (connection === "open") {
        logDebug("Connection opened successfully!");
        connectionStatus = "open";
        qrCode = null;
        isStarting = false;
        io.emit("whatsapp:status", "connected");
      }
    });

    currentSock.ev.on("messages.upsert", async (m: any) => {
      try {
        logDebug(`messages.upsert received. Count: ${m.messages?.length || 0}`);
        
        // Guard against stale socket connections or closed states
        if (sock !== currentSock) {
          logDebug("Skipping messages.upsert: socket instance has been replaced by a newer connection.");
          return;
        }
        if (connectionStatus !== "open") {
          logDebug("Skipping messages.upsert: connection is not fully open yet.");
          return;
        }

        const msg = m.messages[0];
        if (!msg) {
          logDebug("No message object in messages.upsert payload.");
          return;
        }

        const from = msg.key.remoteJid!;
        const fromMe = !!msg.key.fromMe;
        logDebug(`Processing message. RemoteJID: ${from}, FromMe: ${fromMe}, ID: ${msg.key.id}`);

        if (!msg.message) {
          logDebug("Message content is missing/empty (could be a receipt or system stub).");
          return;
        }

        if (fromMe) {
          logDebug("Skipping message because fromMe is true.");
          return;
        }

        if (from.endsWith("@newsletter")) {
          logDebug(`Skipping newsletter message from ${from}.`);
          return;
        }

        if (from.endsWith("@g.us")) {
          logDebug(`Skipping group message from ${from}.`);
          return;
        }

        const text = getMessageText(msg.message);
        logDebug(`Extracted Text content: "${text}"`);

        if (!text || text.trim() === "") {
          logDebug("Message text content is empty or unsupported format. Skipping reply.");
          return;
        }

        logDebug(`Received message from ${from}: ${text}`);

        // 0. Fetch Bot Settings from Firestore
        const docRef = doc(db, "settings", "bot");
        let docSnap = await getDoc(docRef);
        let settings = docSnap.exists() ? docSnap.data() : null;

        // Auto-upgrade empty or outdated professional/friend personality templates to the brand new Introvert Style
        const oldProfessionalText = "You are a helpful and professional WhatsApp assistant.";
        const oldFriendText = "You are a close personal friend chatting on WhatsApp.";
        if (settings && (!settings.personality || settings.personality === oldProfessionalText || settings.personality === oldFriendText)) {
          logDebug("Auto-upgrading old personality default to Introvert Style...");
          try {
            await setDoc(docRef, {
              ...settings,
              personality: DEFAULT_PERSONALITY
            });
            docSnap = await getDoc(docRef);
            settings = docSnap.data() || null;
            logDebug("Introvert Style personality successfully auto-upgraded in Firestore!");
          } catch (err: any) {
            logDebug(`Error auto-upgrading personality in Firestore: ${err.message || err}`);
          }
        }

        if (!settings) {
          logDebug("No bot settings found in database. Using default active state.");
        }

        const isActive = settings ? settings.isActive !== false : true;
        if (!isActive) {
          logDebug("Bot is currently deactivated (settings.isActive is false). Skipping response.");
          return;
        }

        // Double-check active state again before heavy operations
        if (sock !== currentSock || connectionStatus !== "open") return;

        // 0.5 Check Contacts & Strict Mode
        logDebug("Fetching contacts to check persona and strict mode...");
        const contactsRef = doc(db, "settings", "contacts");
        const contactsSnap = await getDoc(contactsRef);
        const contacts = contactsSnap.exists() ? (contactsSnap.data().list || []) : [];
        
        const participantPhone = from.split("@")[0];
        const knownContact = contacts.find((c: any) => c.id === from || c.id.includes(participantPhone));
        
        if (settings && settings.ignoreUnknown && !knownContact) {
          logDebug(`Strict Mode is ON and ${from} is not in contacts. Ignoring message completely.`);
          return;
        }

        // 1. Log Incoming Message to Firestore
        logDebug("Logging incoming message to Firestore...");
        await addDoc(collection(db, "logs"), {
          from: from.split("@")[0],
          to: "Bot",
          message: text,
          type: "incoming",
          timestamp: Timestamp.now(),
          aiResponse: false
        });
        logDebug("Incoming message successfully logged.");

        // 2. Generate AI Response with Conversation History
        logDebug(`Retrieving recent conversation history for ${participantPhone}...`);
        
        let participantLogs: any[] = [];
        try {
          // Fetch last 150 system logs to construct context without needing a custom composite index
          const logsQuery = query(
            collection(db, "logs"),
            orderBy("timestamp", "desc"),
            limit(150)
          );
          const logDocs = await getDocs(logsQuery);
          const rawHistoryList: any[] = [];
          logDocs.forEach((doc) => {
            rawHistoryList.push({ id: doc.id, ...doc.data() });
          });

          // Filter for this participant specifically and sort ascending (oldest first)
          participantLogs = rawHistoryList
            .filter(l => l.from === participantPhone || l.to === participantPhone)
            .sort((a, b) => (a.timestamp?.seconds || 0) - (b.timestamp?.seconds || 0))
            .slice(-10); // Take the last 10 messages for a clean context window
          
          logDebug(`Found ${participantLogs.length} historical messages for ${participantPhone}.`);
        } catch (err) {
          logDebug(`Error fetching history from Firestore: ${err}. Falling back to clean slate.`);
        }

        // Format into alternating user/model messages for Gemini API
        const rawContents = participantLogs.map(log => ({
          role: log.type === "incoming" ? "user" : "model",
          text: log.message
        }));

        // Append the current incoming user message
        rawContents.push({
          role: "user",
          text: text
        });

        // Merge consecutive roles to guarantee strict alternation (user -> model -> user)
        const chatContents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
        for (const msg of rawContents) {
          const last = chatContents[chatContents.length - 1];
          if (last && last.role === msg.role) {
            last.parts[0].text += "\n" + msg.text;
          } else {
            chatContents.push({
              role: msg.role as "user" | "model",
              parts: [{ text: msg.text }]
            });
          }
        }

        let personaInstruction = "";
        if (knownContact) {
          logDebug(`Contact found: ${knownContact.name} - Persona: ${knownContact.category}`);
          if (knownContact.category === "boss") {
            personaInstruction = `You are replying on behalf of Durgaprasad to his Boss/Senior (${knownContact.name}). Be extremely formal, respectful, and highly professional. Use "sir" or proper titles. Keep replies clear, polite, and to the point. No slang, no jokes, and absolutely NO casual behavior.`;
          } else if (knownContact.category === "relative") {
            personaInstruction = `You are replying on behalf of Durgaprasad to a family relative (${knownContact.name}). Be very warm, highly respectful, and caring — like talking to an elder family member. Show respect, use polite Telugu/English language, and avoid heavy slang or jokes.`;
          } else if (knownContact.category === "friend") {
            personaInstruction = `You are replying on behalf of Durgaprasad to a close friend (${knownContact.name}). Keep replies short, casual, and informal (Introvert personality).`;
          } else {
            personaInstruction = settings?.personality || DEFAULT_PERSONALITY;
          }
        } else {
          personaInstruction = settings?.personality || DEFAULT_PERSONALITY;
        }

        const systemInstruction = `You are NOT a virtual assistant, customer support bot, AI model, or automated helper.
You are chatting on WhatsApp on behalf of Durgaprasad.

CRITICAL CONSTRAINTS:
- NEVER say robotic assistant phrases like "How can I help you today", "As an AI...", "As your virtual assistant", "I am here to assist", "Is there anything else", or "How may I help".
- Talk exactly like a real person texting: natural language, casual punctuation.
- IMPORTANT LANGUAGE RULE: Always reply in the EXACT SAME language the person texts in (Telugu, Hindi, English, or mixed). Match their language and script naturally.

Specific Personality & Context instructions to adopt for this specific contact:
${personaInstruction}`;

        let apiKey = settings?.geminiApiKey;
        if (!apiKey || !apiKey.startsWith("AIzaSy")) {
          logDebug("Using system default process.env.GEMINI_API_KEY...");
          apiKey = process.env.GEMINI_API_KEY;
        } else {
          logDebug("Using user-configured custom Gemini API key...");
        }

        if (!apiKey) {
          throw new Error("Gemini API Key is not configured. Please set your API Key in Settings.");
        }

        logDebug("Generating dynamic AI response via Gemini model (gemini-3.5-flash) with history retry support...");
        const dynamicAi = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              "User-Agent": "aistudio-build",
            }
          }
        });

        // Force formatting rules regardless of what is saved in the database
        const finalSystemInstruction = systemInstruction + `\n\nFORMATTING RULES:
- NEVER use quotation marks ("") around words or phrases in your replies — real people don't type like that in casual WhatsApp chats.
- Keep each reply focused on ONE single thought or question — do not combine multiple questions or options in one message.
- Avoid listing multiple options in a single reply. If you're curious, ask just one simple thing.
- Keep messages SHORT — 1 line ideally, max 2 short lines. No exceptions.
- Write like a normal text message, not like a formatted answer.`;

        let aiReply = "";
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          if (sock !== currentSock || connectionStatus !== "open") {
            logDebug("Socket connection state changed during Gemini generation. Aborting message processing.");
            return;
          }
          
          try {
            const result = await dynamicAi.models.generateContent({
              model: "gemini-2.5-flash",
              contents: chatContents as any,
              config: {
                systemInstruction: finalSystemInstruction,
                temperature: 0.85,
                maxOutputTokens: 80,
              }
            });
            aiReply = result.text || "";
            logDebug(`Generated reply (attempt ${attempt}): "${aiReply}"`);
            break; // Success, break retry loop
          } catch (apiError: any) {
            const errorMsg = apiError.message || String(apiError);
            logDebug(`Gemini API call failed on attempt ${attempt}/${maxAttempts}: ${errorMsg.slice(0, 150)}`);

            if (errorMsg.includes("429") || errorMsg.includes("quota") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
              logDebug("Gemini API daily limit reached for current key. Sending limiters-done alert to owner and stopping chat.");
              aiReply = ""; // Stop the chat, do not reply to friends
              
              if (sock === currentSock && connectionStatus === "open") {
                try {
                  logDebug("Sending self message alert to 8688998779...");
                  await currentSock.sendMessage("8688998779@s.whatsapp.net", { text: "limtirs done" });
                  logDebug("Alert message sent successfully.");
                  
                  // Log self message to Firestore
                  await addDoc(collection(db, "logs"), {
                    from: "Bot",
                    to: "8688998779",
                    message: "limtirs done",
                    type: "outgoing",
                    timestamp: Timestamp.now(),
                    aiResponse: true
                  });
                } catch (alertErr: any) {
                  logDebug(`Error sending limiters alert to owner: ${alertErr.message || alertErr}`);
                }
              }
              break; // Do not retry on rate limits
            }

            if (attempt < maxAttempts) {
              const retryDelay = attempt * 1500;
              logDebug(`Temporary error (such as 503 high demand or 500 server error). Retrying in ${retryDelay}ms...`);
              await new Promise(resolve => setTimeout(resolve, retryDelay));
            } else {
              // Out of retries, fallback to a friendly message
              aiReply = "Sorry ra, temporary network issue valla respond avvalekapothunna. Konchem sepu agi text cheyi!";
            }
          }
        }

        // Double-check active state again before sending reply
        if (sock !== currentSock || connectionStatus !== "open") {
          logDebug("Skipping response sending: socket has disconnected or changed during AI generation.");
          return;
        }

        if (aiReply) {
          // 2.5 Apply Natural Introverted Reply Delay
          const delayMs = getDelay(aiReply);
          logDebug(`Applying natural introverted reply delay of ${(delayMs / 1000).toFixed(2)} seconds for response...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));

          // Double check status after the delay
          if (sock !== currentSock || connectionStatus !== "open") {
            logDebug("Skipping response sending: socket has disconnected or changed during reply delay.");
            return;
          }

          // 3. Send Reply via Baileys
          logDebug(`Sending reply to ${from}...`);
          await currentSock.sendMessage(from, { text: aiReply });
          logDebug("Reply sent successfully via Baileys.");

          // 4. Log Outgoing Message to Firestore
          logDebug("Logging outgoing response to Firestore...");
          await addDoc(collection(db, "logs"), {
            from: "Bot",
            to: from.split("@")[0],
            message: aiReply,
            type: "outgoing",
            timestamp: Timestamp.now(),
            aiResponse: true
          });
          logDebug("Outgoing response successfully logged.");
        }

      } catch (error: any) {
        logDebug(`Error processing message inside upsert listener: ${error.message || error}`);
        console.error("Error processing message:", error);
      }
    });
  } catch (error) {
    console.error("Error connecting to WhatsApp:", error);
    isStarting = false;
  }
}

// Socket IO Handlers
io.on("connection", (socket) => {
  console.log("Dashboard client connected");
  
  // If the bot is completely offline, auto-start it when someone opens the dashboard!
  if (connectionStatus === "close" && !isStarting) {
    logDebug("Dashboard client connected and bot is offline. Auto-starting WhatsApp connection...");
    connectToWhatsApp().catch(err => console.error("Error auto-starting WhatsApp on dashboard connect:", err));
  }
  
  // Send current state to new client
  if (qrCode) socket.emit("whatsapp:qr", qrCode);
  socket.emit("whatsapp:status", connectionStatus === "open" ? "connected" : connectionStatus === "connecting" ? "connecting" : "disconnected");

  socket.on("whatsapp:reconnect", () => {
    connectToWhatsApp();
  });

  socket.on("whatsapp:logout", async () => {
    if (sock) {
      try {
        await sock.logout();
      } catch (err) {
        logDebug(`Error during socket logout: ${err}`);
      }
      io.emit("whatsapp:status", "disconnected");
    }
    clearAuthDir();
    qrCode = null;
    connectionStatus = "close";
  });

  // Pairing code request
  socket.on("whatsapp:get_pairing_code", async (phoneNumber: string) => {
    if (sock) {
      try {
        const code = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ""));
        socket.emit("whatsapp:pairing_code", code);
      } catch (err) {
        console.error("Error getting pairing code:", err);
        socket.emit("whatsapp:error", "Failed to get pairing code");
      }
    }
  });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    connectToWhatsApp().catch(err => console.error("Error starting WhatsApp:", err));
  });
}

startServer();
