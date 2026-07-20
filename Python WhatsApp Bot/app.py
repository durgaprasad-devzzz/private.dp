import os
from flask import Flask, request
from twilio.twiml.messaging_response import MessagingResponse
import google.generativeai as genai
from dotenv import load_dotenv
import time

# Load environment variables from .env file
load_dotenv()

SYSTEM_PROMPT = """You are a close friend chatting on WhatsApp. You have an introverted personality — 
calm, low-key, doesn't talk too much, but genuine and caring when it matters.

STYLE:
- Keep replies short and simple — most messages should be 1 line.
- Don't joke in every message, only occasionally.
- Don't ask a question every time — mostly just react or comment.
- Minimal emojis.
- If asked directly "are you AI/bot?", answer honestly — don't deny it.

If asked something factual or technical, give a clear, smart, accurate answer.
"""

user_sessions = {}
load_dotenv()

app = Flask(__name__)

# Configure Gemini API
API_KEY = os.environ.get("GEMINI_API_KEY")
if API_KEY and API_KEY != "your_api_key_here":
    genai.configure(api_key=API_KEY)
    # Using the recommended model for text chat
    model = genai.GenerativeModel('gemini-2.5-flash', system_instruction=SYSTEM_PROMPT)
else:
    print("WARNING: GEMINI_API_KEY is missing or invalid in .env file.")
    print("WARNING: GEMINI_API_KEY is missing or invalid in .env file.")
    model = None

@app.route("/ping", methods=['GET'])
def ping():
    return "OK", 200

@app.route("/whatsapp", methods=['POST'])
def whatsapp_bot():
    # Get the message sent by the user from Twilio's webhook payload
    incoming_msg = request.values.get('Body', '').strip()
    sender = request.values.get('From', '')
    
    print(f"Received message from {sender}: {incoming_msg}")

    # Create Twilio response object
    resp = MessagingResponse()
    msg = resp.message()

    if not model:
        msg.body("Bot configuration error: Gemini API Key is missing. Please check your .env file.")
        return str(resp)

    try:
        # Generate response using Gemini AI
        if sender not in user_sessions:
            user_sessions[sender] = model.start_chat(history=[])
            
        chat = user_sessions[sender]
        ai_response = chat.send_message(incoming_msg)
        reply_text = ai_response.text
        
        # Add natural delay
        time.sleep(2)
    except Exception as e:
        print(f"Error generating AI response: {e}")
        reply_text = "Sorry, I am facing a temporary issue right now. Please try again later."

    # Add the AI's reply to the Twilio response
    msg.body(reply_text)
    
    return str(resp)

if __name__ == "__main__":
    # Run the Flask app on port 5001
    app.run(host="0.0.0.0", port=5001, debug=True)
