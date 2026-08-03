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

STRATEGY = {
    "initialCapital": 100000,
    "support1": 360,
    "support2": 310,
    "resistance1": 395,
    "resistance2": 411.25,
    "stopLoss": 340,
    "buyZone": {"min": 350, "max": 385},
    "dailyProfitTarget": 5000,
    "maxSingleTradePercent": 0.25,  # Tek işlemde max %25
    "minCashReserve": 0.25,         # Her zaman min %25 nakit tut
    "commissionRate": 0.002,
}

def get_current_price():
    import urllib.request

    req = urllib.request.Request(
        'https://query1.finance.yahoo.com/v8/finance/chart/ASELS.IS',
        headers={'User-Agent': 'Mozilla/5.0'}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read()
            data = json.loads(html.decode('utf-8'))
            price = data['chart']['result'][0]['meta']['regularMarketPrice']
            prev_close = data['chart']['result'][0]['meta']['chartPreviousClose']
            print(f"Yahoo Finance Canlı Veri -> Fiyat: {price}, Önceki Kapanış: {prev_close}")
            return round(float(price), 2), round(float(prev_close), 2)
    except Exception as e:
        print('Yahoo Finance Bağlantı Hatası (Yedek veri kullanılıyor):', e)
        return 370.0, 358.75

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
        "previousClose": 358.75,
        "avgCost": 0,
        "totalCost": 0,
        "trades": [],
        "aiThoughts": "Bot bulutta başarıyla başlatıldı!",
        "plannedAction": "Piyasalar izleniyor..."
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

def calculate_indicators(state, current_price, prev_close):
    """Teknik göstergeler hesapla"""
    price_change_pct = ((current_price - prev_close) / prev_close) * 100
    shares = state.get("shares", 0)
    avg_cost = state.get("avgCost", 0)
    cash = state.get("cash", 100000)
    total_capital = cash + (shares * current_price)
    cash_ratio = cash / total_capital if total_capital > 0 else 1.0
    stock_ratio = (shares * current_price) / total_capital if total_capital > 0 else 0.0

    unrealized_pnl = (current_price - avg_cost) * shares if shares > 0 else 0
    unrealized_pct = ((current_price - avg_cost) / avg_cost * 100) if avg_cost > 0 else 0

    # Bugünkü işlemleri analiz et
    tz = pytz.timezone('Europe/Istanbul')
    now = datetime.now(tz)
    today = now.strftime('%Y-%m-%d')
    today_trades = [t for t in state.get("trades", []) if t.get("date", "").startswith(today)]
    today_buy_total = sum(t.get("total", 0) for t in today_trades if t.get("type") == "ALIM")
    today_sell_total = sum(t.get("total", 0) for t in today_trades if t.get("type") == "SATIM")

    return {
        "price_change_pct": round(price_change_pct, 2),
        "cash_ratio": round(cash_ratio * 100, 1),
        "stock_ratio": round(stock_ratio * 100, 1),
        "unrealized_pnl": round(unrealized_pnl, 2),
        "unrealized_pct": round(unrealized_pct, 2),
        "total_capital": round(total_capital, 2),
        "today_trades_count": len(today_trades),
        "today_buy_total": round(today_buy_total, 2),
        "today_sell_total": round(today_sell_total, 2),
        "in_buy_zone": STRATEGY["buyZone"]["min"] <= current_price <= STRATEGY["buyZone"]["max"],
        "above_resistance1": current_price > STRATEGY["resistance1"],
        "below_stop_loss": current_price < STRATEGY["stopLoss"],
        "near_support1": STRATEGY["support1"] - 5 <= current_price <= STRATEGY["support1"] + 10,
    }

def make_ai_decision(state, current_price, prev_close, indicators):
    """Gemini AI ile güçlü bağlam sağlayarak karar al"""

    cash = state.get("cash", 100000)
    shares = state.get("shares", 0)
    avg_cost = state.get("avgCost", 0)
    total_capital = indicators["total_capital"]
    max_buy_value = total_capital * STRATEGY["maxSingleTradePercent"]
    max_buy_qty = int(max_buy_value / current_price) if current_price > 0 else 0
    # Minimum %25 nakit rezervi koru
    spendable_cash = max(0, cash - total_capital * STRATEGY["minCashReserve"])
    affordable_qty = int(spendable_cash / (current_price * (1 + STRATEGY["commissionRate"])))
    buy_qty_suggestion = min(max_buy_qty, affordable_qty)
    sell_qty_suggestion = min(shares, max(1, int(shares * 0.5)))

    situation = "ALIMA uygun fiyat bölgesi" if indicators["in_buy_zone"] else (
        "SATIS bölgesi (direnc kirimi)" if indicators["above_resistance1"] else (
        "STOP-LOSS bölgesi - ACIL SATIS!" if indicators["below_stop_loss"] else
        "Nötr bölge"
    ))

    prompt = f"""
Sen ASELSAN (ASELS.IS) için çalışan bir BIST trading yapay zekasısın.
Tek amacın: Her işlem gününde net KAR elde etmek. Hedef: Günde +5.000 TL kar.

=== MEVCUT DURUM ===
Tarih/Saat: {datetime.now(pytz.timezone('Europe/Istanbul')).strftime('%Y-%m-%d %H:%M')}
ASELS Canli Fiyat: {current_price} TL
Önceki Kapanis: {prev_close} TL
Günlük Degisim: {indicators['price_change_pct']:+.2f}%

=== PORTFOYUM ===
Nakit: {cash:.2f} TL
ASELS Hisselerim: {shares} adet
Ortalama Maliyetim: {avg_cost:.2f} TL
Hisselerin Güncel Degeri: {shares * current_price:.2f} TL
Gerçeklesmemis K/Z: {indicators['unrealized_pnl']:+.2f} TL ({indicators['unrealized_pct']:+.2f}%)
Toplam Portföy Degeri: {total_capital:.2f} TL
Nakit Orani: %{indicators['cash_ratio']}
Hisse Orani: %{indicators['stock_ratio']}

=== STRATEJI KURALLARI (KESINLIKLE UYULMASI GEREKEN) ===
- Stop-Loss: {STRATEGY['stopLoss']} TL (Bu fiyatin altina duserse HISSELERIN TAMAMINI SAT!)
- Destek 1: {STRATEGY['support1']} TL (Bu seviyede alim firsati)
- Destek 2: {STRATEGY['support2']} TL (Güçlü destek)
- Direnc 1: {STRATEGY['resistance1']} TL (Ilk kar alma noktasi - pozisyonun %30-50'sini sat)
- Direnc 2: {STRATEGY['resistance2']} TL (Ikinci kar alma - pozisyonun %50'sini sat)
- Maksimum Tek Islem: Toplam Sermayenin %{int(STRATEGY['maxSingleTradePercent']*100)}'u
- Minimum Nakit Rezervi: Toplam Sermayenin %{int(STRATEGY['minCashReserve']*100)}'si HER ZAMAN kasada kalmali

=== TEKNIK DEGERLENDIRME ===
Mevcut Durum: {situation}
Alim Bölgesinde mi? {'EVET - Iyi fiyat!' if indicators['in_buy_zone'] else 'HAYIR'}
Direnci Asti mi? {'EVET - Kar al!' if indicators['above_resistance1'] else 'HAYIR'}
Stop-Loss altinda mi? {'EVET - ACIL SAT!' if indicators['below_stop_loss'] else 'HAYIR'}
Destek yakininda mi? {'EVET - Alim firsati!' if indicators['near_support1'] else 'HAYIR'}

=== BUGÜNKÜ ISLEM DURUMU ===
Bugün yapilan islem sayisi: {indicators['today_trades_count']}
Bugün alinan toplam tutar: {indicators['today_buy_total']:.2f} TL
Bugün satilan toplam tutar: {indicators['today_sell_total']:.2f} TL

=== KARAR VERME KILAVUZU ===
ONEMLI: Piyasa ACIK ise, pasif kalmak YASAKTIR.

ALIM KOSULLARI (herhangi biri yeterliyse BUY ver):
1. Fiyat {STRATEGY['support1']}-{STRATEGY['buyZone']['max']} TL araliginda VE nakit %30'dan fazla ise
2. Fiyat düsüs trendinde destek seviyesine yaklasiyorsa VE hic hisse yoksa
3. Günlük degisim %-2'nin altindaysa VE fiyat alim bölgesindeyse

SATIS KOSULLARI (herhangi biri yeterliyse SELL ver):
1. Fiyat {STRATEGY['resistance1']} TL'nin ÜSTÜNDE ise hisselerin %30-50'sini sat
2. Fiyat {STRATEGY['resistance2']} TL'nin ÜSTÜNDE ise hisselerin %50'sini sat
3. Fiyat {STRATEGY['stopLoss']} TL'nin ALTINDA ise TAMAMEN SAT (stop-loss)
4. Gerçeklesmemis kar %10'un üstüne çiktiysa kar alma düsün

BEKLEME KOSULLARI (sadece bu durumlarda HOLD ver):
1. Fiyat {STRATEGY['buyZone']['max']}-{STRATEGY['resistance1']} TL araliginda nötr bölge VE hic hisse yoksa
2. Nakit zaten %75'in altinda VE fiyat hedef seviyelerden uzaktaysa

Alınabilecek max hisse (sermayenin %{int(STRATEGY['maxSingleTradePercent']*100)}'i ile): {buy_qty_suggestion} adet
Satilabilecek hisse (%50 pozisyon küçültme): {sell_qty_suggestion} adet

SADECE JSON formatinda karar ver, baska hicbir sey yazma:
{{"action": "BUY", "quantity": {buy_qty_suggestion}, "reason": "Türkce gerekce", "planned_action": "Türkce detayli plan"}}
"""

    try:
        response = model.generate_content(prompt)
        ai_resp = response.text.strip()
        # JSON temizleme
        if "```json" in ai_resp:
            ai_resp = ai_resp.split("```json")[1].split("```")[0].strip()
        elif "```" in ai_resp:
            ai_resp = ai_resp.split("```")[1].split("```")[0].strip()
        decision = json.loads(ai_resp)
        print("AI Karari:", decision)
        return decision
    except Exception as e:
        print("AI Hatasi:", str(e))
        return None

def apply_decision(state, decision, current_price):
    """AI kararını uygula ve state'i güncelle"""
    tz = pytz.timezone('Europe/Istanbul')
    timestamp = datetime.now(tz).strftime('%Y-%m-%d %H:%M:%S')

    action = decision.get("action", "HOLD").upper()
    quantity = int(decision.get("quantity", 0))
    reason = decision.get("reason", "")
    planned = decision.get("planned_action", "Piyasalar izleniyor...")

    state["plannedAction"] = planned

    if action == "BUY" and quantity > 0:
        cost = quantity * current_price
        commission = cost * STRATEGY["commissionRate"]
        total_cost = cost + commission
        if total_cost <= state["cash"]:
            state["cash"] -= total_cost
            state["totalCost"] = state.get("totalCost", 0) + cost
            state["shares"] = state.get("shares", 0) + quantity
            state["avgCost"] = state["totalCost"] / state["shares"]
            state["trades"].insert(0, {
                "date": timestamp,
                "type": "ALIM",
                "price": current_price,
                "amount": quantity,
                "total": round(total_cost, 2),
                "commission": round(commission, 2)
            })
            state["aiThoughts"] = f"🟢 ALIM: {quantity} adet @{current_price}₺ | {reason}"
            print(f"ALIM GERCEKLESTI: {quantity} adet @{current_price} = {total_cost:.2f} TL (komisyon dahil)")
        else:
            state["aiThoughts"] = f"⚠️ ALIM BASARISIZ: Yetersiz nakit ({state['cash']:.2f}TL < {total_cost:.2f}TL)"
            print(f"ALIM BASARISIZ: Yetersiz nakit")

    elif action == "SELL" and quantity > 0:
        available = state.get("shares", 0)
        sell_qty = min(quantity, available)
        if sell_qty > 0:
            revenue = sell_qty * current_price
            commission = revenue * STRATEGY["commissionRate"]
            net_revenue = revenue - commission
            cost_basis = sell_qty * state.get("avgCost", 0)
            pnl = net_revenue - cost_basis

            state["cash"] += net_revenue
            state["totalCost"] = max(0, state.get("totalCost", 0) - cost_basis)
            state["shares"] = available - sell_qty
            if state["shares"] == 0:
                state["avgCost"] = 0
                state["totalCost"] = 0
            state["trades"].insert(0, {
                "date": timestamp,
                "type": "SATIM",
                "price": current_price,
                "amount": sell_qty,
                "total": round(net_revenue, 2),
                "commission": round(commission, 2),
                "pnl": round(pnl, 2)
            })
            pnl_text = f"+{pnl:.2f} TL KAR" if pnl >= 0 else f"{pnl:.2f} TL ZARAR"
            state["aiThoughts"] = f"🔴 SATIS: {sell_qty} adet @{current_price}₺ | {pnl_text} | {reason}"
            print(f"SATIS GERCEKLESTI: {sell_qty} adet @{current_price} | {pnl_text}")
        else:
            state["aiThoughts"] = f"⏸️ BEKLE: Satacak hisse yok | {reason}"
    else:
        state["aiThoughts"] = f"⏸️ BEKLE: {reason}"
        print(f"BEKLEME: {reason}")

    return state

def check_and_generate_daily_report(state, current_price):
    tz = pytz.timezone('Europe/Istanbul')
    now = datetime.now(tz)

    current_date = now.strftime('%Y-%m-%d')
    report_state = state.get("dailyReport", {})

    # 18:00 ve sonrasında çalışıyorsa ve bugün için rapor yazılmadıysa
    if now.hour >= 18 and report_state.get("date") != current_date:
        print("Günlük rapor hazırlanıyor...")

        today_trades = [t for t in state.get("trades", []) if t['date'].startswith(current_date)]
        today_pnl = sum(t.get("pnl", 0) for t in today_trades if t.get("type") == "SATIM")

        prompt = f"""
        Sen profesyonel bir BIST-ASELS trading robotunun yapay zekasısın.
        Bugünün Tarihi: {current_date}
        ASELS Kapanis Fiyati: {current_price} TL
        Portföy Durumu:
        Nakit: {state['cash']:.2f} TL | Hisse: {state.get('shares', 0)} adet | Ortalama Maliyet: {state.get('avgCost', 0):.2f} TL
        Bugün yapilan islemler: {json.dumps(today_trades, ensure_ascii=False)}
        Bugünkü Gerceklesen Kar/Zarar: {today_pnl:.2f} TL
        Günlük Hedef: 5.000 TL

        Lütfen bugünün borsa kapanis raporunu Türkçe olarak hazirla.
        Raporda sunlar olsun:
        1. Bugün piyasa hareketleri ve portföyün performansi nasildi?
        2. Yapilan islemlerin mantigi neydi (islem yoksa neden yapilmadi)?
        3. Yarin için nasil bir yol izlenmeli? 5.000 TL günlük kar hedefine ulasmak için nelere dikkat edilmeli?

        Format: Markdown formatinda samimi ve profesyonel bir dille yaz. Raporu kisa tut (en fazla 3 paragraf).
        """
        try:
            response = model.generate_content(prompt)
            report_text = response.text.strip()
            state["dailyReport"] = {
                "date": current_date,
                "text": report_text,
                "dailyPnL": round(today_pnl, 2)
            }
            print("Günlük kapanış raporu başarıyla oluşturuldu!")
        except Exception as e:
            print("Rapor oluşturma hatası:", e)

def run_trading_bot():
    tz = pytz.timezone('Europe/Istanbul')
    now = datetime.now(tz)
    hour = now.hour
    weekday = now.weekday()  # 0=Pazartesi, 6=Pazar

    print(f"=== AI BOT BASLADI === {now.strftime('%Y-%m-%d %H:%M:%S')}")

    # Piyasa saatleri kontrolü (Pazartesi-Cuma, 10:00-18:00)
    market_open = (weekday < 5) and (10 <= hour < 18)
    print(f"Piyasa durumu: {'ACIK' if market_open else 'KAPALI'}")

    state = fetch_state_from_github()
    current_price, previous_close = get_current_price()
    state["currentPrice"] = current_price
    state["previousClose"] = previous_close

    if not market_open:
        print("Piyasa kapalı, sadece veri güncelleniyor...")
        state["aiThoughts"] = state.get("aiThoughts", "Piyasa kapalı, yarın için hazırlanıyorum.")
        # Kapanış raporu kontrolü (18:00 sonrası)
        check_and_generate_daily_report(state, current_price)
        update_state_in_github(state)
        return

    # Piyasa açık — analiz ve işlem yap
    indicators = calculate_indicators(state, current_price, previous_close)
    print(f"Göstergeler: {indicators}")

    # Stop-loss kontrolü — AI'ya gerek yok, otomatik sat
    if indicators["below_stop_loss"] and state.get("shares", 0) > 0:
        print(f"STOP-LOSS TETIKLENDI! Fiyat ({current_price}TL) < Stop ({STRATEGY['stopLoss']}TL)")
        decision = {
            "action": "SELL",
            "quantity": state["shares"],
            "reason": f"STOP-LOSS! Fiyat {current_price}TL ile {STRATEGY['stopLoss']}TL stop seviyesinin altina dustu!",
            "planned_action": f"Stop-loss tetiklendi. Tüm pozisyon {current_price}TL'den kapatildi. Piyasa {STRATEGY['support2']}TL desteğine gelene kadar nakit bekleniyor."
        }
    else:
        decision = make_ai_decision(state, current_price, previous_close, indicators)

    if decision:
        state = apply_decision(state, decision, current_price)
    else:
        state["aiThoughts"] = "AI analiz hatası — bir sonraki döngüde tekrar denenecek."

    # Günlük rapor kontrolü
    check_and_generate_daily_report(state, current_price)

    # GitHub'ı güncelle
    update_state_in_github(state)
    print("=== BOT TAMAMLANDI ===")

if __name__ == "__main__":
    run_trading_bot()
