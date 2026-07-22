/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import { db, auth } from "./firebase";
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  Timestamp
} from "firebase/firestore";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from "firebase/auth";
import { 
  Settings, 
  Activity, 
  Save, 
  LogOut, 
  LogIn,
  Bot,
  Link,
  QrCode,
  Smartphone,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  AlertCircle,
  Eye,
  EyeOff,
  MessageSquare,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";

interface BotSettings {
  botName: string;
  personality: string;
  isActive: boolean;
  geminiApiKey?: string;
}

interface MessageLog {
  id: string;
  from: string;
  to: string;
  message: string;
  type: "incoming" | "outgoing";
  timestamp: Timestamp;
  aiResponse?: boolean;
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
- If asked directly "are you AI/bot?", answer honestly — don't deny it.`;

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<BotSettings>({
    botName: "AI Assistant",
    personality: DEFAULT_PERSONALITY,
    isActive: true,
    geminiApiKey: "",
  });
  const [logs, setLogs] = useState<MessageLog[]>([]);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"settings" | "link" | "logs">("link");
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);

  // WhatsApp Connection State
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connStatus, setConnStatus] = useState<"connected" | "disconnected" | "connecting" | "pairing">("disconnected");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isRequestingPairing, setIsRequestingPairing] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (user) {
      // Connect Socket.IO
      if (!socketRef.current) {
        socketRef.current = io();
      }
      const s = socketRef.current;

      s.on("whatsapp:qr", (qr) => {
        setQrCode(qr);
        setPairingCode(null);
      });

      s.on("whatsapp:status", (status) => {
        setConnStatus(status);
        if (status === "connected") {
          setQrCode(null);
          setPairingCode(null);
        }
      });

      s.on("whatsapp:pairing_code", (code) => {
        setPairingCode(code);
        setIsRequestingPairing(false);
      });

      s.on("whatsapp:error", (err) => {
        alert(err);
        setIsRequestingPairing(false);
      });

      // Fetch settings
      const fetchSettings = async () => {
        const docRef = doc(db, "settings", "bot");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setSettings({
            botName: data.botName || "AI Assistant",
            personality: data.personality || DEFAULT_PERSONALITY,
            isActive: data.isActive !== false,
            geminiApiKey: data.geminiApiKey || ""
          });
        } else {
          try {
            await setDoc(docRef, {
              botName: "AI Assistant",
              personality: DEFAULT_PERSONALITY,
              isActive: true,
              geminiApiKey: ""
            });
          } catch (e) {
            console.error("Error initializing settings in DB:", e);
          }
        }
      };
      fetchSettings();

      // Subscribe to logs
      const q = query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(50));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const newLogs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as MessageLog[];
        setLogs(newLogs);
      });

      return () => {
        unsubscribe();
      };
    }
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const saveSettings = async () => {
    if (!user) return;
    
    // Ask for password before saving
    const enteredPassword = window.prompt("Please enter the admin password to save changes:");
    const correctPassword = import.meta.env.VITE_ADMIN_PASSWORD;

    if (enteredPassword !== correctPassword) {
      alert("❌ Incorrect Password! You are not allowed to change settings.");
      return;
    }

    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "bot"), settings);
      alert("✅ Settings saved successfully!");
    } catch (error) {
      console.error(error);
      alert("Error saving settings!");
    } finally {
      setSaving(false);
    }
  };

  const handleReconnect = () => {
    socketRef.current?.emit("whatsapp:reconnect");
  };

  const handleLogoutWhatsApp = () => {
    if (confirm("Are you sure you want to log out from WhatsApp?")) {
      socketRef.current?.emit("whatsapp:logout");
    }
  };

  const handleGetPairingCode = () => {
    if (!phoneNumber) return alert("Please enter a phone number");
    setIsRequestingPairing(true);
    socketRef.current?.emit("whatsapp:get_pairing_code", phoneNumber);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-12 h-12 text-emerald-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-slate-100"
        >
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Bot className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">WhatsApp Bot</h1>
          <p className="text-slate-500 mb-8">AI-powered automatic replies for WhatsApp Web.</p>
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg"
          >
            <LogIn className="w-5 h-5" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <Bot className="w-8 h-8 text-emerald-600" />
          <span className="font-bold text-xl text-slate-800">Bot Panel</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <button
            onClick={() => setActiveTab("link")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === "link" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Link className="w-5 h-5" />
            Link Device
          </button>
          <button
            onClick={() => setActiveTab("settings")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === "settings" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Settings className="w-5 h-5" />
            AI Settings
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
              activeTab === "logs" ? "bg-emerald-50 text-emerald-700 font-medium" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <Activity className="w-5 h-5" />
            Message Logs
          </button>
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-4 px-2">
            <img src={user.photoURL || ""} className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
            <div className="overflow-hidden">
              <p className="text-sm font-medium text-slate-900 truncate">{user.displayName}</p>
              <p className="text-xs text-slate-500 truncate">{user.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-3 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg text-sm font-medium">
            <LogOut className="w-4 h-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-8">
        <AnimatePresence mode="wait">
          {activeTab === "link" ? (
            <motion.div key="link" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-4xl mx-auto">
              <header className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Link WhatsApp Device</h2>
                <p className="text-slate-500">Connect your account to start the auto-reply bot.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Status Card */}
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
                  <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-4 ${
                    connStatus === "connected" ? "bg-emerald-100 text-emerald-600" : 
                    connStatus === "connecting" ? "bg-blue-100 text-blue-600" : "bg-red-100 text-red-600"
                  }`}>
                    {connStatus === "connected" ? <CheckCircle2 className="w-8 h-8" /> : 
                     connStatus === "connecting" ? <Loader2 className="w-8 h-8 animate-spin" /> : <XCircle className="w-8 h-8" />}
                  </div>
                  <h3 className="font-bold text-lg text-slate-900">
                    {connStatus === "connected" ? "Authenticated" : 
                     connStatus === "connecting" ? "Connecting..." : "Not Connected"}
                  </h3>
                  <p className="text-sm text-slate-500 mt-2 mb-6">
                    {connStatus === "connected" ? "Bot is active and listening for messages." : 
                     "Link your device using QR or Pairing Code."}
                  </p>
                  
                  {connStatus === "connected" ? (
                    <button onClick={handleLogoutWhatsApp} className="w-full py-2 bg-red-50 text-red-600 rounded-xl font-medium hover:bg-red-100 transition-colors">
                      Log Out from WhatsApp
                    </button>
                  ) : (
                    <button onClick={handleReconnect} className="w-full flex items-center justify-center gap-2 py-2 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors">
                      <RefreshCw className="w-4 h-4" /> Refresh Connection
                    </button>
                  )}
                </div>

                {/* Connection Methods */}
                <div className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  {connStatus === "connected" ? (
                    <div className="p-12 flex flex-col items-center justify-center h-full text-emerald-600">
                      <Smartphone className="w-16 h-16 mb-4 opacity-20" />
                      <p className="font-medium">Device successfully linked via WhatsApp Web</p>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full">
                      <div className="flex border-b border-slate-100">
                        <button className="flex-1 py-4 px-6 flex items-center justify-center gap-2 font-medium text-emerald-600 border-b-2 border-emerald-600">
                          <QrCode className="w-4 h-4" /> QR Code
                        </button>
                      </div>
                      
                      <div className="p-8 flex-1 flex flex-col items-center">
                        {qrCode ? (
                          <div className="relative group">
                            <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64 border-4 border-white shadow-lg rounded-xl" />
                            <div className="mt-6 text-center">
                              <p className="text-sm font-medium text-slate-700">Scan this code with WhatsApp</p>
                              <p className="text-xs text-slate-500 mt-1">Open WhatsApp &gt; Settings &gt; Linked Devices</p>
                            </div>
                          </div>
                        ) : pairingCode ? (
                          <div className="text-center py-12">
                             <p className="text-sm text-slate-500 mb-4">Your Pairing Code:</p>
                             <div className="text-4xl font-mono font-bold tracking-widest text-emerald-600 bg-emerald-50 px-8 py-4 rounded-2xl border border-emerald-100">
                               {pairingCode}
                             </div>
                             <p className="text-xs text-slate-400 mt-6 max-w-xs mx-auto">
                               Enter this on your phone after selecting "Link with phone number instead"
                             </p>
                             <button onClick={() => setPairingCode(null)} className="mt-8 text-sm text-slate-500 hover:text-emerald-600 transition-colors">
                               Back to QR Code
                             </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Loader2 className="w-12 h-12 text-emerald-200 animate-spin mb-4" />
                            <p className="text-slate-500">Generating connection session...</p>
                            
                            <div className="mt-8 w-full max-w-sm border-t border-slate-100 pt-8">
                               <p className="text-sm font-medium text-slate-700 mb-4">Or use Pairing Code</p>
                               <div className="flex gap-2">
                                 <input 
                                   type="text" 
                                   placeholder="Phone Number (e.g. 15551234567)"
                                   className="flex-1 px-4 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
                                   value={phoneNumber}
                                   onChange={(e) => setPhoneNumber(e.target.value)}
                                 />
                                 <button 
                                   onClick={handleGetPairingCode}
                                   disabled={isRequestingPairing}
                                   className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors disabled:bg-slate-400"
                                 >
                                   {isRequestingPairing ? "..." : "Link"}
                                 </button>
                               </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ) : activeTab === "settings" ? (
            <motion.div key="settings" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="max-w-3xl">
              <header className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">AI Personality</h2>
                <p className="text-slate-500">Configure how the bot translates your intent into replies.</p>
              </header>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-700">Bot Name</label>
                      <input
                        type="text"
                        value={settings.botName}
                        onChange={(e) => setSettings({ ...settings, botName: e.target.value })}
                        className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-4 pt-8">
                      <label className="text-sm font-semibold text-slate-700">Auto-Reply Active</label>
                      <button
                        onClick={() => setSettings({ ...settings, isActive: !settings.isActive })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settings.isActive ? "bg-emerald-600" : "bg-slate-200"
                        }`}
                      >
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.isActive ? "translate-x-6" : "translate-x-1"}`} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Gemini API Key</label>
                    <div className="relative flex items-center">
                      <input
                        type={showApiKey ? "text" : "password"}
                        value={settings.geminiApiKey || ""}
                        onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                        placeholder="Enter your Gemini API Key"
                        className="w-full pl-4 pr-10 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    </div>
                    <p className="text-xs text-slate-400">Used by the bot to generate intelligent responses. Stored securely in your private database settings.</p>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1 mt-1">
                      <span className="font-semibold block">💡 API Quota & Silent Mode:</span>
                      <p>
                        The default system key is strictly limited to <b>20 messages per day</b>. If the limit is reached, the bot will silently ignore further chats from friends, but will send you a private alert message (<i>"limtirs done"</i>) on your WhatsApp (8688998779) so you know when to swap keys! Get a personal key at <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="underline font-bold hover:text-amber-950">Google AI Studio</a>.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-700">Personality Instructions (System Prompt)</label>
                    <textarea
                      rows={6}
                      value={settings.personality}
                      onChange={(e) => setSettings({ ...settings, personality: e.target.value })}
                      className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
                    />
                    <p className="text-xs text-slate-400">Describe tone, language, and behavior rules for the AI.</p>
                  </div>
                </div>

                <div className="bg-slate-50 p-6 flex justify-end">
                  <button onClick={saveSettings} disabled={saving} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-semibold py-2 px-8 rounded-xl transition-all shadow-md">
                    <Save className="w-4 h-4" /> {saving ? "Saving..." : "Save Config"}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="logs" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <header className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">Message Logs</h2>
                <p className="text-slate-500">History of interactions from your linked WhatsApp account.</p>
              </header>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Time</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Participant</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Message</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {logs.length === 0 ? (
                        <tr><td colSpan={5} className="px-6 py-12 text-center text-slate-400">No messages logged yet.</td></tr>
                      ) : (
                        logs.map((log) => {
                          const participant = log.type === "incoming" ? log.from : log.to;
                          const cleanParticipant = participant.split("@")[0];
                          return (
                            <tr 
                              key={log.id} 
                              onClick={() => setSelectedParticipant(participant)}
                              className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                            >
                              <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">
                                {log.timestamp.toDate().toLocaleString()}
                              </td>
                              <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                                {cleanParticipant}
                              </td>
                              <td className="px-6 py-4 text-sm text-slate-700 break-words whitespace-pre-wrap max-w-md min-w-[200px]">
                                {log.message}
                              </td>
                              <td className="px-6 py-4 whitespace-nowrap">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  log.type === "incoming" ? "bg-blue-100 text-blue-800" : "bg-emerald-100 text-emerald-800"
                                }`}>
                                  {log.type === "incoming" ? "Incoming" : "AI Replied"}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => setSelectedParticipant(participant)}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-all"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  View Chat
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* WhatsApp-Style Chat History Modal */}
              <AnimatePresence>
                {selectedParticipant && (() => {
                  const cleanParticipantName = selectedParticipant.split("@")[0];
                  const participantLogs = logs
                    .filter(l => l.from === selectedParticipant || l.to === selectedParticipant)
                    .sort((a, b) => a.timestamp.seconds - b.timestamp.seconds);

                  return (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
                      onClick={() => setSelectedParticipant(null)}
                    >
                      <motion.div
                        initial={{ scale: 0.95, y: 15 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.95, y: 15 }}
                        className="bg-slate-50 w-full max-w-lg rounded-2xl shadow-xl overflow-hidden border border-slate-200 flex flex-col h-[600px]"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Header */}
                        <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-700 font-bold">
                              {cleanParticipantName.slice(0, 2).toUpperCase() || "WA"}
                            </div>
                            <div>
                              <h3 className="font-semibold text-slate-800">
                                {cleanParticipantName}
                              </h3>
                              <p className="text-xs text-slate-400">
                                WhatsApp Conversation Thread
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedParticipant(null)}
                            className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-lg transition-colors"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>

                        {/* Message body with ambient grid background */}
                        <div 
                          className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#f0f2f5] relative" 
                          style={{ 
                            backgroundImage: "radial-gradient(#dfdfdf 1.2px, transparent 1.2px)", 
                            backgroundSize: "16px 16px" 
                          }}
                        >
                          {participantLogs.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-slate-400">
                              <MessageSquare className="w-12 h-12 mb-2 opacity-50" />
                              <p className="text-sm">No messages found for this participant.</p>
                            </div>
                          ) : (
                            participantLogs.map((item) => {
                              const isMe = item.type === "outgoing" || item.aiResponse === true;
                              return (
                                <div
                                  key={item.id}
                                  className={`flex w-full ${isMe ? "justify-end" : "justify-start"}`}
                                >
                                  <div
                                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm text-sm break-words whitespace-pre-wrap ${
                                      isMe
                                        ? "bg-emerald-600 text-white rounded-tr-none"
                                        : "bg-white text-slate-800 rounded-tl-none border border-slate-150"
                                    }`}
                                  >
                                    <p>{item.message}</p>
                                    <div
                                      className={`text-[10px] mt-1 text-right leading-none ${
                                        isMe ? "text-emerald-100" : "text-slate-400"
                                      }`}
                                    >
                                      {item.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>

                        {/* Footer info */}
                        <div className="bg-white border-t border-slate-200 px-6 py-3 text-center">
                          <p className="text-xs text-slate-400 font-medium">
                            Bot Panel Interactive Chat Viewer
                          </p>
                        </div>
                      </motion.div>
                    </motion.div>
                  );
                })()}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
