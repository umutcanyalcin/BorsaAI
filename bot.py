import os
import json
import requests
import google.generativeai as genai
from datetime import datetime
import pytz

# Yapılandırma
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
REPO_NAME = os.environ.get("GITHUB_REPOSITORY")  # Format: "username/repo"

if not GEMINI_API_KEY:
    print("HATA: GEMINI_API_KEY bulunamadı!")
    exit(1)

if not GITHUB_TOKEN or not REPO_NAME:
    print("HATA: GITHUB_TOKEN veya GITHUB_REPOSITORY bulunamadı!")
    exit(1)

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel('gemini-1.5-flash')

def get_current_price():
    import random
    # Test senaryosu için rastgele fiyat (Canlı veri eklenebilir)
    base_price = 370.0
    fluctuation = random.uniform(-2.0, 2.0)
    return round(base_price + fluctuation, 2)

def fetch_state_from_github():
    url = f"https://raw.githubusercontent.com/{REPO_NAME}/main/database.json"
    headers = {"Authorization": f"token {GITHUB_TOKEN}"}
    resp = requests.get(url, headers=headers)
    if resp.status_code == 200:
        try:
            return resp.json()
        except:
            pass
    return {
        "cash": 100000,
        "shares": 0,
        "currentPrice": 370.00,
        "avgCost": 0,
        "totalCost": 0,
        "trades": [],
        "aiThoughts": "Bot bulutta başarıyla başlatıldı!"
    }

def update_state_in_github(new_state):
    api_url = f"https://api.github.com/repos/{REPO_NAME}/contents/database.json"
    headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json"
    }
    
    resp = requests.get(api_url, headers=headers)
    sha = None
    if resp.status_code == 200:
        sha = resp.json().get("sha")
        
    import base64
    content_b64 = base64.b64encode(json.dumps(new_state, indent=4).encode('utf-8')).decode('utf-8')
    
    data = {
        "message": "AI Bot: Piyasa durumu güncellendi 🤖",
        "content": content_b64,
        "branch": "main"
    }
    if sha:
        data["sha"] = sha
        
    put_resp = requests.put(api_url, headers=headers, json=data)
    if put_resp.status_code in [200, 201]:
        print("GitHub database başarıyla güncellendi!")
    else:
        print(f"HATA: Güncelleme başarısız - {put_resp.text}")

def run_trading_bot():
    print("AI Bot Çalışıyor...")
    state = fetch_state_from_github()
    current_price = get_current_price()
    state["currentPrice"] = current_price
    
    prompt = f"""
    Sen profesyonel bir Borsa İstanbul (ASELS) yatırımcısısın.
    Şu anki ASELS fiyatı: {current_price} TL.
    Nakit: {state['cash']} TL | Hisse: {state['shares']} adet
    KURAL: 360 destek, 395 direnç, 340 stop-loss. Max tek işlem %25 sermaye.
    Sadece JSON formatında yanıt ver: {{"action": "BUY", "quantity": 10, "reason": "Destekten döndü"}} veya "SELL" veya "HOLD".
    """
    
    try:
        response = model.generate_content(prompt)
        ai_resp = response.text.strip().replace("```json", "").replace("```", "")
        decision = json.loads(ai_resp)
        print("AI Kararı:", decision)
        
        action = decision.get("action")
        quantity = int(decision.get("quantity", 0))
        reason = decision.get("reason", "")
        
        timestamp = datetime.now(pytz.timezone('Europe/Istanbul')).strftime('%Y-%m-%d %H:%M:%S')
        
        if action == "BUY" and quantity > 0 and state["cash"] >= (quantity * current_price):
            cost = quantity * current_price
            state["cash"] -= cost
            state["totalCost"] += cost
            state["shares"] += quantity
            state["avgCost"] = state["totalCost"] / state["shares"]
            state["trades"].insert(0, {"date": timestamp, "type": "ALIM", "price": current_price, "amount": quantity, "total": cost})
            state["aiThoughts"] = f"🟢 ALIM: {reason}"
            
        elif action == "SELL" and quantity > 0 and state["shares"] >= quantity:
            revenue = quantity * current_price
            state["cash"] += revenue
            cost_basis = quantity * state["avgCost"]
            state["totalCost"] -= cost_basis
            state["shares"] -= quantity
            if state["shares"] == 0:
                state["avgCost"] = 0
                state["totalCost"] = 0
            state["trades"].insert(0, {"date": timestamp, "type": "SATIM", "price": current_price, "amount": quantity, "total": revenue})
            state["aiThoughts"] = f"🔴 SATIŞ: {reason}"
        else:
            state["aiThoughts"] = f"⏸️ BEKLE: {reason}"
            
    except Exception as e:
        print("AI Hatası:", str(e))
        state["aiThoughts"] = "AI Analiz Hatası: Beklemeye geçildi."

    update_state_in_github(state)

if __name__ == "__main__":
    run_trading_bot()
