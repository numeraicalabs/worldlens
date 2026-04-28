"""
WorldLens KG Mega-Seed v2
==========================
3000+ curated nodes across 6 domains:
  • S&P500 + STOXX + Nikkei companies (400+)
  • Global ETFs UCITS + US (150+)
  • All countries with macro data (195)
  • Key financial/political people (80+)
  • International institutions + treaties (100+)
  • Extended financial concepts + instruments (200+)

Run: POST /api/kg/mega-seed-v2
"""
from __future__ import annotations
import asyncio
import logging
from typing import Dict, List, Optional, Tuple

import aiosqlite
from config import settings

logger = logging.getLogger(__name__)

# ── COMPANIES: S&P500 + STOXX600 + Nikkei sample ─────────────────────────────
# Format: (ticker, name, sector, description)
COMPANIES = [
    # ── US Tech ──
    ("AAPL",  "Apple",         "Technology",  "Consumer electronics, iOS, Mac, services. $3T+ market cap. China manufacturing risk."),
    ("MSFT",  "Microsoft",     "Technology",  "Cloud Azure, Office 365, GitHub, OpenAI. Most diversified tech mega-cap."),
    ("NVDA",  "Nvidia",        "Technology",  "AI GPU monopoly. H100/B200 data center chips. $2T+ cap. Export control risk."),
    ("GOOGL", "Alphabet",      "Technology",  "Google Search, YouTube, Google Cloud, DeepMind. AI competition risk."),
    ("AMZN",  "Amazon",        "Consumer",    "E-commerce #1, AWS cloud leader, advertising. 3 distinct businesses."),
    ("META",  "Meta",          "Technology",  "Facebook, Instagram, WhatsApp, Threads. $1T+ ad revenue machine."),
    ("TSLA",  "Tesla",         "Auto/Energy", "EV leader, FSD autonomous, energy storage. Elon Musk brand/risk."),
    ("AVGO",  "Broadcom",      "Technology",  "Semiconductors + VMware acquisition. AI custom chips for hyperscalers."),
    ("AMD",   "AMD",           "Technology",  "CPU (EPYC) + GPU (MI300) challenger to Intel and Nvidia."),
    ("INTC",  "Intel",         "Technology",  "Legacy CPU maker restructuring. Foundry ambitions. Behind TSMC/Samsung."),
    ("ORCL",  "Oracle",        "Technology",  "Cloud database, ERP. AI infrastructure partnerships with OpenAI."),
    ("CRM",   "Salesforce",    "Technology",  "CRM leader. AI (Einstein/Agentforce) transformation push."),
    ("ADBE",  "Adobe",         "Technology",  "Creative software (Photoshop, Premiere). Generative AI integration."),
    ("NOW",   "ServiceNow",    "Technology",  "Enterprise workflow automation. AI agents for IT/HR/finance."),
    ("INTU",  "Intuit",        "Technology",  "TurboTax, QuickBooks, Mailchimp. SMB financial software."),
    ("NFLX",  "Netflix",       "Media",       "Streaming leader. 260M+ subscribers. Ad-supported tier growing."),
    ("UBER",  "Uber",          "Technology",  "Ride-hailing + food delivery. Autonomous vehicle partnerships."),
    ("ABNB",  "Airbnb",        "Consumer",    "Home sharing platform. Travel demand proxy. Asset-light model."),
    ("PLTR",  "Palantir",      "Technology",  "AI/data analytics for government and enterprise. AIP platform."),
    ("SNOW",  "Snowflake",     "Technology",  "Cloud data warehouse. AI data platform competition with Databricks."),
    # ── US Finance ──
    ("JPM",   "JPMorgan Chase","Finance",     "Largest US bank. $3T+ assets. IB leader. Jamie Dimon CEO."),
    ("BAC",   "Bank of America","Finance",    "Retail bank #2. Rate-sensitive NIM. Merrill Lynch wealth management."),
    ("WFC",   "Wells Fargo",   "Finance",     "Retail bank. Fed asset cap still in place. Consumer finance focus."),
    ("GS",    "Goldman Sachs", "Finance",     "Investment bank. Trading, advisory, asset management. Marcus consumer exit."),
    ("MS",    "Morgan Stanley","Finance",     "Wealth management + IB. E*Trade acquisition. Asset-light pivot."),
    ("BLK",   "BlackRock",     "Finance",     "$10T+ AUM. iShares ETF creator. Aladdin risk platform. Larry Fink."),
    ("BX",    "Blackstone",    "Finance",     "Largest alternative asset manager. Real estate, PE, credit. $1T AUM."),
    ("KKR",   "KKR",           "Finance",     "Private equity, infrastructure, credit. $500B+ AUM."),
    ("V",     "Visa",          "Finance",     "Payment network #1. 40B+ transactions/year. Asset-light toll road."),
    ("MA",    "Mastercard",    "Finance",     "Payment network #2. Cross-border transaction premium."),
    ("AXP",   "American Express","Finance",   "Premium card network + bank. Affluent customer base."),
    ("COF",   "Capital One",   "Finance",     "Credit card + digital bank. Discover acquisition pending."),
    ("SCHW",  "Charles Schwab","Finance",     "Discount brokerage + bank. Rate cycle sensitive."),
    ("BRK",   "Berkshire Hathaway","Finance", "Warren Buffett. BNSF, GEICO, Berkshire Energy. $300B+ cash."),
    # ── US Healthcare ──
    ("LLY",   "Eli Lilly",     "Healthcare",  "GLP-1 obesity/diabetes drugs (Mounjaro, Zepbound). AI drug discovery."),
    ("JNJ",   "Johnson & Johnson","Healthcare","MedTech + pharma. Kenvue spinoff. Talc litigation ongoing."),
    ("UNH",   "UnitedHealth",  "Healthcare",  "Largest US health insurer. Optum health services vertically integrated."),
    ("ABBV",  "AbbVie",        "Healthcare",  "Humira successor drugs (Skyrizi, Rinvoq). Allergan aesthetics."),
    ("MRK",   "Merck",         "Healthcare",  "Keytruda cancer immunotherapy. HPV vaccine. Animal health."),
    ("PFE",   "Pfizer",        "Healthcare",  "Post-COVID restructuring. Oncology portfolio. Seagen acquisition."),
    ("TMO",   "Thermo Fisher", "Healthcare",  "Lab equipment + reagents. Life science tools picks-and-shovels."),
    ("ISRG",  "Intuitive Surgical","Healthcare","Surgical robots (da Vinci). Recurring instrument revenue model."),
    # ── US Energy ──
    ("XOM",   "ExxonMobil",    "Energy",      "Largest US oil major. Pioneer acquisition. Carbon capture investments."),
    ("CVX",   "Chevron",       "Energy",      "Integrated oil major. Hess acquisition. Permian Basin growth."),
    ("COP",   "ConocoPhillips","Energy",      "E&P pure play. Marathon Oil acquisition. Low-cost shale producer."),
    ("SLB",   "SLB (Schlumberger)","Energy",  "Oilfield services leader. Digital/AI for well optimization."),
    ("NEE",   "NextEra Energy","Energy",       "Largest US renewable energy utility. Wind + solar + storage leader."),
    # ── US Consumer ──
    ("WMT",   "Walmart",       "Consumer",    "Retail #1 global. Grocery 60%+ revenue. Flipkart India. Ad business."),
    ("COST",  "Costco",        "Consumer",    "Membership warehouse model. Loyalty moat. Inflation-resistant."),
    ("TGT",   "Target",        "Consumer",    "Discount retail. Own-brand margin premium. Same-day delivery growth."),
    ("MCD",   "McDonald's",    "Consumer",    "QSR global franchise. Asset-light royalty model. 40K+ locations."),
    ("SBUX",  "Starbucks",     "Consumer",    "Coffee chain restructuring. China weakness. Loyalty program moat."),
    ("NKE",   "Nike",          "Consumer",    "Athletic footwear/apparel. DTC push. China demand sensitivity."),
    ("HD",    "Home Depot",    "Consumer",    "Home improvement retail. Pro contractor focus. Housing cycle proxy."),
    ("LOW",   "Lowe's",        "Consumer",    "Home improvement #2. DIY focus. Margin expansion story."),
    # ── US Industrial ──
    ("BA",    "Boeing",        "Industrial",  "Commercial + defense aircraft. 737 MAX quality crisis. Backlog 5500+."),
    ("LMT",   "Lockheed Martin","Industrial", "F-35 fighter, Sikorsky, missiles. Defense budget beneficiary."),
    ("RTX",   "RTX (Raytheon)","Industrial",  "Jet engines (Pratt & Whitney) + missile systems. GTF engine issue."),
    ("CAT",   "Caterpillar",   "Industrial",  "Construction + mining machinery. China exposure. Infrastructure proxy."),
    ("DE",    "Deere",         "Industrial",  "Agricultural equipment. Precision agriculture AI. Cyclical demand."),
    ("GE",    "GE Aerospace",  "Industrial",  "Jet engines post-Vernova spinoff. Aftermarket services focus."),
    ("HON",   "Honeywell",     "Industrial",  "Industrial automation, aerospace, building tech. Spinoff planned."),
    ("UPS",   "UPS",           "Industrial",  "Package delivery. E-commerce volume decline post-COVID. Labor costs."),
    # ── European Champions ──
    ("SAP",   "SAP",           "Technology",  "European ERP leader. S/4HANA cloud transition. AI Joule copilot."),
    ("ASML",  "ASML",          "Technology",  "EUV lithography monopoly. Only maker of machines for 3nm+ chips."),
    ("NOVO",  "Novo Nordisk",  "Healthcare",  "GLP-1 drugs (Ozempic, Wegovy). Obesity market leader from Denmark."),
    ("LVMH",  "LVMH",          "Consumer",    "Luxury goods conglomerate. Louis Vuitton, Dior, Moet Hennessy."),
    ("NESN",  "Nestlé",        "Consumer",    "Food & beverage giant. Nespresso, Purina, Nescafé. Pricing power."),
    ("ROG",   "Roche",         "Healthcare",  "Pharma + diagnostics. Cancer drugs. Genentech unit."),
    ("NOVN",  "Novartis",      "Healthcare",  "Swiss pharma. Radioligand therapy. Kisqali breast cancer drug."),
    ("SHEL",  "Shell",         "Energy",      "Anglo-Dutch oil major. LNG leader. Energy transition investments."),
    ("BP",    "BP",            "Energy",      "UK oil major. Net zero 2050 target. North Sea + Gulf of Mexico."),
    ("TTE",   "TotalEnergies", "Energy",      "French oil major. LNG + renewables dual strategy. Africa exposure."),
    ("AIR",   "Airbus",        "Industrial",  "Commercial aircraft #1. A320neo family. A350 widebody growth."),
    ("SIE",   "Siemens",       "Industrial",  "Industrial automation + smart infrastructure. Digital twin leader."),
    ("ADS",   "Adidas",        "Consumer",    "Athletic apparel #2. Yeezy controversy resolved. China recovery."),
    ("BMW",   "BMW Group",     "Auto",        "Premium EV + ICE transition. iX/i4/i5 lineup. China 33% revenue."),
    ("MBG",   "Mercedes-Benz", "Auto",        "Ultra-premium auto + van. EV transition slower than planned."),
    ("VOW",   "Volkswagen",    "Auto",        "EV transition cost crisis. Germany plant closures debate."),
    # ── Asian Champions ──
    ("TSM",   "TSMC",          "Technology",  "World's largest foundry. Makes chips for Apple, Nvidia, AMD. Taiwan risk."),
    ("005930","Samsung Electronics","Technology","DRAM + NAND memory + smartphones. HBM3 for AI GPUs."),
    ("6758",  "Sony Group",    "Consumer",    "PlayStation, sensors, entertainment. Image sensor monopoly."),
    ("7203",  "Toyota",        "Auto",        "Hybrid leader (Prius). Hydrogen bet. #1 global auto unit sales."),
    ("9984",  "SoftBank",      "Finance",     "Vision Fund tech investments. ARM Holdings. AI bet thesis."),
    ("9988",  "Alibaba",       "Consumer",    "Chinese e-commerce + cloud. Jack Ma return. Regulatory reset."),
    ("0700",  "Tencent",       "Technology",  "WeChat super-app + gaming. China regulatory environment."),
    ("2330",  "TSMC TWO",      "Technology",  "Taiwan Stock Exchange listed. Same as TSM ADR."),
    ("RELIANCE","Reliance Industries","Consumer","India conglomerate. Jio telecom + retail + O2C. Mukesh Ambani."),
    ("TCS",   "Tata Consultancy","Technology","India IT services leader. AI transformation demand beneficiary."),
]

# ── GLOBAL ETFs (UCITS + US) ──────────────────────────────────────────────────
GLOBAL_ETFS = [
    # ── Broad equity ──
    ("VWCE",  "Vanguard FTSE All-World UCITS",     "Global Equity",        "3900+ stocks globally. TER 0.22%. EU investor core holding."),
    ("IWDA",  "iShares Core MSCI World UCITS",      "Developed Equity",     "1500 DM stocks. TER 0.20%. No EM exposure."),
    ("SSAC",  "iShares Core MSCI World UCITS (Acc)","Developed Equity",     "MSCI World accumulating. Popular EU alternative to IWDA."),
    ("SWRD",  "SPDR MSCI World UCITS",              "Developed Equity",     "Low TER MSCI World alternative. 0.12%."),
    ("FWRA",  "Invesco FTSE All-World UCITS",       "Global Equity",        "FTSE All-World cheaper alternative. TER 0.15%."),
    ("EMAE",  "iShares Core MSCI EM IMI UCITS",     "Emerging Equity",      "EM including small caps. TER 0.18%."),
    ("EIMI",  "iShares Core MSCI EM IMI UCITS II",  "Emerging Equity",      "Complement to IWDA for EM exposure."),
    ("SPY",   "SPDR S&P 500 ETF",                   "US Equity",            "$500B+ AUM. Most liquid ETF globally. TER 0.09%."),
    ("IVV",   "iShares Core S&P 500 ETF",           "US Equity",            "BlackRock S&P500. TER 0.03%. Largest iShares."),
    ("VOO",   "Vanguard S&P 500 ETF",               "US Equity",            "Vanguard S&P500. TER 0.03%. Retail favorite."),
    ("QQQ",   "Invesco QQQ Trust",                  "US Tech Equity",       "Nasdaq-100. ~40% in top 5 mega-caps. TER 0.20%."),
    ("VTI",   "Vanguard Total Stock Market ETF",    "US Equity",            "Entire US market including small caps. TER 0.03%."),
    ("IWM",   "iShares Russell 2000 ETF",           "US Small Cap",         "US small cap benchmark. More economically sensitive."),
    ("MDY",   "SPDR S&P MidCap 400",               "US Mid Cap",           "US mid-cap exposure between large and small."),
    ("EFA",   "iShares MSCI EAFE ETF",              "Intl Developed Equity","Europe + Australasia + Far East developed markets."),
    ("VEA",   "Vanguard FTSE Developed Markets",    "Intl Developed Equity","Developed ex-US. FTSE methodology."),
    ("EEM",   "iShares MSCI Emerging Markets ETF",  "Emerging Equity",      "Legacy EM benchmark. TER 0.68%."),
    ("VWO",   "Vanguard FTSE Emerging Markets ETF", "Emerging Equity",      "FTSE EM (excludes Korea). TER 0.08%."),
    ("IEMG",  "iShares Core MSCI EM ETF",           "Emerging Equity",      "Comprehensive EM with small caps. TER 0.09%."),
    # ── Fixed income ──
    ("IBGL",  "iShares Euro Govt Bond UCITS",       "EUR Bonds",            "EUR sovereign IG. Duration ~8Y. TER 0.09%."),
    ("VETY",  "Vanguard EUR Govt Bond UCITS",       "EUR Bonds",            "EUR government bonds. Vanguard alternative."),
    ("TLT",   "iShares 20+ Year Treasury ETF",      "US Long Bonds",        "20Y+ US treasuries. Duration ~17Y. Risk-off asset."),
    ("IEF",   "iShares 7-10 Year Treasury ETF",     "US Mid Bonds",         "7-10Y US government bonds. Medium duration."),
    ("SHY",   "iShares 1-3 Year Treasury ETF",      "US Short Bonds",       "Short duration. Near-cash. Rate cycle hedge."),
    ("AGG",   "iShares Core US Aggregate Bond ETF", "US Broad Bonds",       "Entire US fixed income market. Duration ~6Y."),
    ("BND",   "Vanguard Total Bond Market ETF",     "US Broad Bonds",       "Vanguard AGG equivalent. TER 0.03%."),
    ("LQD",   "iShares iBoxx USD IG Corp Bond ETF", "US Corp IG",           "Investment grade corporate bonds. Duration ~9Y."),
    ("HYG",   "iShares iBoxx USD HY Corp Bond ETF", "US Corp HY",           "High yield corporate bonds. Credit risk barometer."),
    ("JNK",   "SPDR Bloomberg HY Bond ETF",         "US Corp HY",           "HYG alternative. Slightly different HY methodology."),
    ("EMB",   "iShares JP Morgan EM Bond ETF",      "EM Bonds",             "Emerging market USD-denominated sovereign bonds."),
    ("VWOB",  "Vanguard EM Govt Bond ETF",          "EM Bonds",             "Vanguard EM sovereign bonds. TER 0.20%."),
    ("TIPS",  "iShares TIPS Bond ETF",              "Inflation-Linked",     "US Treasury Inflation-Protected Securities."),
    ("IBCI",  "iShares EUR Inflation Linked Govt",  "Inflation-Linked",     "EUR inflation-linked government bonds."),
    # ── Commodities ──
    ("GLD",   "SPDR Gold Shares",                   "Gold",                 "Physical gold. $60B+ AUM. TER 0.40%."),
    ("IAU",   "iShares Gold Trust",                 "Gold",                 "Physical gold. Cheaper TER 0.25%."),
    ("XGLD",  "Xetra-Gold",                         "Gold",                 "Deliverable gold ETC. Deutsche Börse listed."),
    ("PHAU",  "WisdomTree Physical Gold ETC",       "Gold",                 "EU-listed physical gold. Popular UCITS alternative."),
    ("SLV",   "iShares Silver Trust",               "Silver",               "Physical silver. Higher volatility than gold."),
    ("PPLT",  "Aberdeen Physical Platinum ETF",     "Platinum",             "Physical platinum. Auto catalyst demand."),
    ("COPX",  "Global X Copper Miners ETF",         "Copper/Mining",        "Copper mining stocks. EV transition exposure."),
    ("USO",   "United States Oil Fund",             "Oil",                  "WTI crude futures. Contango cost warning."),
    ("BNO",   "United States Brent Oil Fund",       "Oil",                  "Brent crude futures. European oil benchmark."),
    ("DBO",   "Invesco DB Oil Fund",                "Oil",                  "Oil with optimized roll. Less contango drag."),
    ("DJP",   "iPath Bloomberg Commodity Index ETN","Broad Commodities",    "Diversified commodity exposure via index."),
    ("PDBC",  "Invesco Optimum Yield Commodity",    "Broad Commodities",    "Active roll commodity strategy. Diversified."),
    # ── Sector ETFs ──
    ("XLF",   "Financial Select Sector SPDR",       "US Finance Sector",    "US banks, insurance, brokers. Rate sensitive."),
    ("XLK",   "Technology Select Sector SPDR",      "US Tech Sector",       "US tech sector. AAPL + MSFT = 40%."),
    ("XLE",   "Energy Select Sector SPDR",          "US Energy Sector",     "US oil and gas companies. Oil price proxy."),
    ("XLV",   "Health Care Select Sector SPDR",     "US Healthcare Sector", "US healthcare. Defensive. Drug pricing risk."),
    ("XLU",   "Utilities Select Sector SPDR",       "US Utilities Sector",  "Rate-sensitive bond proxy. High dividend yield."),
    ("XLI",   "Industrial Select Sector SPDR",      "US Industrial Sector", "US industrials. Defense + capex cycle proxy."),
    ("XLB",   "Materials Select Sector SPDR",       "US Materials Sector",  "US materials and mining. Commodity sensitive."),
    ("XLRE",  "Real Estate Select Sector SPDR",     "US Real Estate Sector","US REITs. Rate sensitive. CRE stress exposure."),
    ("XLC",   "Communication Svcs Select Sector",   "US Comms Sector",      "Alphabet + Meta + telecoms. Ad cycle proxy."),
    ("XLY",   "Consumer Discret Select Sector",     "US Discretionary",     "Amazon + Tesla heavy. Consumer cycle proxy."),
    ("XLP",   "Consumer Staples Select Sector",     "US Staples",           "Defensive consumer goods. Recession resistant."),
    # ── Factor / smart beta ──
    ("MTUM",  "iShares MSCI USA Momentum ETF",      "Momentum Factor",      "US stocks with strong recent price momentum."),
    ("QUAL",  "iShares MSCI USA Quality ETF",        "Quality Factor",       "High ROE, stable earnings, low leverage."),
    ("USMV",  "iShares MSCI USA Min Vol ETF",        "Low Volatility Factor","Lower beta US stocks. Defensive factor."),
    ("VLUE",  "iShares MSCI USA Value ETF",          "Value Factor",         "Low P/E, P/B US stocks. Contrarian bet."),
    ("SIZE",  "iShares MSCI USA Size ETF",           "Size Factor",          "Equal weight tilt toward smaller companies."),
    ("SPHD",  "Invesco S&P 500 High Div Low Vol",   "Dividend/Low Vol",     "High dividend + low volatility S&P 500 stocks."),
    ("VIG",   "Vanguard Dividend Appreciation ETF", "Dividend Growth",      "US stocks with 10+ consecutive years dividend growth."),
    ("DVY",   "iShares Select Dividend ETF",        "High Dividend",        "High dividend yield US stocks."),
    # ── Thematic ──
    ("ARKK",  "ARK Innovation ETF",                 "Disruptive Tech",      "Cathie Wood active. AI, genomics, fintech. High risk."),
    ("BOTZ",  "Global X Robotics & AI ETF",         "Robotics/AI",          "Robotics, AI, automation companies globally."),
    ("LIT",   "Global X Lithium & Battery Tech ETF","Lithium/EV",           "Lithium miners + battery tech. EV transition play."),
    ("ICLN",  "iShares Global Clean Energy ETF",    "Clean Energy",         "Solar, wind, clean energy stocks globally."),
    ("CIBR",  "First Trust NASDAQ Cybersecurity",   "Cybersecurity",        "Cybersecurity companies. Defense spending growth."),
    ("ROBO",  "Robo Global Robotics & Automation",  "Robotics",             "Industrial and service robots globally."),
    ("GDX",   "VanEck Gold Miners ETF",             "Gold Miners",          "Gold mining stocks. 2x beta to gold price."),
    ("GDXJ",  "VanEck Junior Gold Miners ETF",      "Gold Miners",          "Junior gold miners. Higher leverage to gold."),
    ("AMLP",  "Alerian MLP ETF",                    "Energy Infrastructure","US energy midstream MLP. High yield."),
    ("VNQ",   "Vanguard Real Estate ETF",           "Real Estate",          "US REITs. Office, retail, residential, industrial."),
    # ── Leveraged/Inverse (informational) ──
    ("TQQQ",  "ProShares UltraPro QQQ 3x",         "Leveraged",            "3x daily Nasdaq-100. Decay risk. Short-term only."),
    ("SQQQ",  "ProShares UltraPro Short QQQ 3x",   "Inverse Leveraged",    "3x inverse Nasdaq-100. Bearish speculation."),
    ("SPXU",  "ProShares UltraPro Short S&P 3x",   "Inverse Leveraged",    "3x inverse S&P 500. Extreme short-term hedge."),
]

# ── 195 COUNTRIES ─────────────────────────────────────────────────────────────
COUNTRIES = [
    # G20
    ("United States","G20","World's largest economy ($27T GDP). Military superpower. Dollar reserve currency issuer."),
    ("China","G20","Second largest economy ($17T). Manufacturing powerhouse. Taiwan risk. PBOC managed currency."),
    ("Germany","G20","Europe's largest economy. Industrial exports. Energy transition crisis. Aging demographics."),
    ("Japan","G20","3rd largest economy. BOJ YCC. Deflation history. Semiconductor and auto expertise."),
    ("India","G20","Fastest growing major economy (7%+). Manufacturing China+1. Modi government. Young demographics."),
    ("United Kingdom","G20","Post-Brexit economy. Financial services hub. North Sea oil. BoE inflation fighter."),
    ("France","G20","5th largest economy. Nuclear power 70%+. Luxury goods. CAC40 global champions."),
    ("Italy","G20","BTP-Bund spread barometer. North industrial powerhouse vs South divergence."),
    ("Canada","G20","Oil sands + financial services. CAD oil currency. Close US trade ties. BOC policy."),
    ("Australia","G20","Commodity exporter. Iron ore, coal, LNG. China demand proxy. RBA rate decisions."),
    ("Brazil","G20","Largest LatAm economy. Soy, iron ore, oil. Bolsonaro→Lula policy shift. BRL volatility."),
    ("South Korea","G20","Semiconductor + EV battery hub. Samsung, SK Hynix, LG Energy. North Korea risk."),
    ("Mexico","G20","Nearshoring beneficiary. USMCA trade. Remittances from US. AMLO→Sheinbaum."),
    ("Indonesia","G20","4th most populous. Nickel reserves (EV). Growing middle class. Coal exporter."),
    ("Turkey","G20","NATO member. Unorthodox monetary policy. Erdogan. Inflation crisis. Lira weakness."),
    ("Argentina","G20","Serial debt crises. Dollarization debate. Milei reforms. IMF negotiations."),
    ("Saudi Arabia","G20","Swing oil producer. Vision 2030 diversification. OPEC+ leader. Aramco IPO."),
    ("South Africa","G20","Mining (gold, platinum, chrome). Load shedding crisis. ANC political risk."),
    ("Russia","G20","Suspended. Ukraine war sanctions. Oil price cap. SWIFT exclusion. Rerouting oil to Asia."),
    ("European Union","G20","27-country bloc. $17T GDP. Largest trading bloc. ECB monetary policy."),
    # Europe
    ("Switzerland","Europe","Safe haven currency. Banking secrecy legacy. Pharmaceutical exports. SNB interventions."),
    ("Netherlands","Europe","Trade hub (Rotterdam port). Semiconductor exports (ASML). Shell, Philips."),
    ("Spain","Europe","Tourism recovery. Renewable energy leader. Banco Santander financial hub."),
    ("Sweden","Europe","Krona under pressure. Ericsson, Volvo, H&M. NATO member. Housing market stress."),
    ("Norway","Europe","Sovereign wealth fund ($1.6T GPFG). Oil and gas exporter. NATO."),
    ("Poland","Europe","Fastest growing EU economy. Defense spending surge. Manufacturing hub."),
    ("Belgium","Europe","EU institutions hub. Diamond trade (Antwerp). AB InBev brewing."),
    ("Denmark","Europe","Krone ERM II peg. Shipping (Maersk). Wind energy (Vestas, Orsted)."),
    ("Finland","Europe","Nokia legacy. Forest industry. NATO member. Russia border economy."),
    ("Austria","Europe","EU member. Vienna financial hub. Eastern Europe gateway."),
    ("Portugal","Europe","Tourism + renewables. Golden visa controversy. Mild sovereign risk."),
    ("Greece","Europe","Debt crisis legacy. Tourism recovery. Shipping hub."),
    ("Czech Republic","Europe","Manufacturing (autos). Koruna. EU member. Low unemployment."),
    ("Hungary","Europe","Orban EU friction. Budapest financial hub. Chinese EV investment target."),
    ("Romania","Europe","IT outsourcing hub. EU member. Leu currency. Energy exporter."),
    ("Ukraine","Europe","War with Russia. Grain exporter. EU accession candidate. Reconstruction need."),
    # Middle East
    ("Israel","Middle East","Tech hub (Start-Up Nation). Defense industry. Iron Dome. Gaza conflict."),
    ("Iran","Middle East","Oil under sanctions. Nuclear program. Proxy conflicts. IRGC."),
    ("UAE","Middle East","Dubai financial hub. Abu Dhabi sovereign wealth (ADIA, Mubadala). Crypto hub."),
    ("Qatar","Middle East","LNG exporter #1. $450B sovereign wealth (QIA). World Cup legacy."),
    ("Kuwait","Middle East","Oil exporter. KIA sovereign wealth fund. OPEC member."),
    ("Bahrain","Middle East","Financial hub. Gulf banking center. US Navy 5th Fleet."),
    ("Oman","Middle East","Oil exporter. Muscat Stock Exchange. Strategic Strait of Hormuz position."),
    ("Iraq","Middle East","OPEC quota disputes. Political instability. Oil infrastructure."),
    ("Jordan","Middle East","Refugee crisis host. Aqaba port. Water scarcity."),
    ("Lebanon","Middle East","Financial collapse 2019. Hyperinflation. Hezbollah power."),
    # Asia-Pacific
    ("Taiwan","Asia-Pacific","TSMC home. Chipmaking critical node. China reunification threat."),
    ("Singapore","Asia-Pacific","Financial hub. Port #2 globally. MAS monetary policy. Crypto regulation."),
    ("Hong Kong","Asia-Pacific","HKMA dollar peg. Financial center under NatSec law."),
    ("Thailand","Asia-Pacific","Tourism economy. Auto manufacturing hub. Political instability."),
    ("Vietnam","Asia-Pacific","Manufacturing China+1. Samsung, Intel, Nike production. VND."),
    ("Malaysia","Asia-Pacific","Semiconductor packaging hub. Palm oil. Ringgit."),
    ("Philippines","Asia-Pacific","BPO/outsourcing. Remittances 9% GDP. Infrastructure push."),
    ("Pakistan","Asia-Pacific","IMF program. Political crisis. Nuclear power. Inflation crisis."),
    ("Bangladesh","Asia-Pacific","Garment exports #2 globally. Fast growth. Political transition."),
    ("Sri Lanka","Asia-Pacific","Debt default 2022. IMF rescue. Tourism recovery."),
    ("Myanmar","Asia-Pacific","Military coup 2021. Sanctions. Jade + gas exports."),
    ("New Zealand","Asia-Pacific","RBNZ aggressive rate hikes. Dairy exports. China trade."),
    # Africa
    ("Nigeria","Africa","Largest African economy. Oil delta. Naira devaluation. Tinubu reforms."),
    ("Egypt","Africa","Suez Canal toll income. IMF program. EGP weakness."),
    ("Kenya","Africa","East Africa hub. Nairobi financial center. M-Pesa mobile money."),
    ("Ethiopia","Africa","Fastest African growth pre-civil war. GERD dam. Coffee exporter."),
    ("Ghana","Africa","Cocoa + gold exporter. Debt default 2022. IMF program."),
    ("Morocco","Africa","Phosphate reserves (75% global). Green hydrogen potential. Auto hub."),
    ("Angola","Africa","Oil producer. Lobito Corridor infrastructure. IMF program."),
    ("Tanzania","Africa","East Africa growing economy. LNG potential. Gold miner."),
    # Americas
    ("Colombia","Americas","Oil + coffee + flowers exporter. Petro government. FARC peace process."),
    ("Chile","Americas","Copper #1 producer. Lithium reserves. Constitutional referendum."),
    ("Peru","Americas","Copper + gold + lithium. Political instability. Milei model interest."),
    ("Venezuela","Americas","Oil reserves #1 globally. Maduro. Sanctions. Hyperinflation."),
    ("Ecuador","Americas","Oil exporter. Dollarized economy. Security crisis."),
    ("Bolivia","Americas","Lithium triangle. Evo Morales legacy. SOE economy."),
    ("Paraguay","Americas","Soy + cattle exporter. Hydropower (Itaipu). Dollar proxy."),
    ("Uruguay","Americas","Stable democracy. Regional financial hub. Beef exporter."),
    ("Cuba","Americas","US embargo. Soviet legacy economy. Tourism + biotech."),
    ("Jamaica","Americas","Tourism. Remittances. JMD. Cannabis legalization."),
    ("Costa Rica","Americas","High income LatAm. Green energy 99%+ renewable. Med devices exports."),
    ("Panama","Americas","Canal toll income. Banking hub. Dollarized. Colon free trade zone."),
    # Central Asia
    ("Kazakhstan","Central Asia","Uranium #1 producer. Oil (Tengiz). KZT. Post-Nazarbayev transition."),
    ("Azerbaijan","Central Asia","Caspian oil (SOCAR). BTC pipeline. IDP from Karabakh."),
    ("Uzbekistan","Central Asia","Gold + cotton. Market reforms. Population 37M. UZS."),
]

# ── KEY PEOPLE ────────────────────────────────────────────────────────────────
KEY_PEOPLE = [
    # Central bankers
    ("Jerome Powell",  "person", "Chair of the Federal Reserve since 2018. Yale law. Former private equity (Carlyle)."),
    ("Christine Lagarde","person","President of the ECB since 2019. Former IMF head and French finance minister."),
    ("Kazuo Ueda",     "person", "Bank of Japan Governor since April 2023. First academic BOJ governor. YCC exit architect."),
    ("Andrew Bailey",  "person", "Bank of England Governor since 2020. Former FCA CEO."),
    ("Agustín Carstens","person","BIS General Manager. Former Banco de México Governor. Macro stability voice."),
    ("Gita Gopinath",  "person", "IMF First Deputy MD. Former Harvard economist. Macro forecasting authority."),
    ("Kristalina Georgieva","person","IMF Managing Director. Former World Bank CEO. Bulgarian economist."),
    ("Pan Gongsheng",  "person", "PBOC Governor since 2023. Former State Administration of Foreign Exchange."),
    ("Roberto Campos Neto","person","Banco Central do Brasil President. Crypto-open central banker."),
    ("Tiff Macklem",   "person", "Bank of Canada Governor. First to raise rates aggressively post-COVID."),
    # Finance ministers / fiscal
    ("Janet Yellen",   "person", "US Treasury Secretary. Former Fed Chair. First woman in both roles."),
    ("Olaf Scholz",    "person", "German Chancellor. Former Finance Minister. SPD coalition challenges."),
    ("Rachel Reeves",  "person", "UK Chancellor of the Exchequer. First woman in the role."),
    ("Bruno Le Maire", "person", "French Finance Minister. Deficit hawk. Moody's downgrade warning."),
    ("Giancarlo Giorgetti","person","Italian Economy Minister. Lega. Fiscal discipline under Meloni."),
    # Tech CEOs
    ("Jensen Huang",   "person", "Nvidia CEO and co-founder. AI GPU revolution architect. Highest-paid CEO."),
    ("Tim Cook",       "person", "Apple CEO since 2011. Supply chain genius. China relationships."),
    ("Satya Nadella",  "person", "Microsoft CEO. Cloud transformation leader. OpenAI partnership architect."),
    ("Elon Musk",      "person", "Tesla + SpaceX + X CEO. DOGE advisor. Crypto influencer. xAI founder."),
    ("Sam Altman",     "person", "OpenAI CEO. GPT-4/5 architect. Trillion-dollar chip ambition."),
    ("Mark Zuckerberg","person", "Meta CEO and co-founder. Llama open-source AI bet. VR/AR pivot."),
    ("Sundar Pichai",  "person", "Alphabet CEO. Gemini AI pivot. Search antitrust trial."),
    ("Andy Jassy",     "person", "Amazon CEO since 2021. AWS architect. Retail cost discipline."),
    ("Jamie Dimon",    "person", "JPMorgan Chase CEO. Most influential US banker. Geopolitical risk commentator."),
    ("Larry Fink",     "person", "BlackRock CEO. ESG and climate finance thought leader. Annual letter bellwether."),
    ("Ray Dalio",      "person", "Bridgewater founder. All-Weather portfolio. Changing world order thesis."),
    ("Warren Buffett", "person", "Berkshire Hathaway CEO. Value investing legend. Annual letter must-read."),
    # Political leaders
    ("Donald Trump",   "person", "US President 2025-. Tariff hawk. Dollar weakness stance. Crypto-friendly."),
    ("Xi Jinping",     "person", "Chinese President + CCP General Secretary. Taiwan policy. BRI architect."),
    ("Vladimir Putin", "person", "Russian President. Ukraine invasion architect. Sanctions target."),
    ("Narendra Modi",  "person", "Indian PM. BJP. Make in India. Digital India. G20 host 2023."),
    ("Giorgia Meloni", "person", "Italian PM since 2022. FdI. EU budget friction. Defense spending."),
    ("Emmanuel Macron","person", "French President. EU army advocate. Industrial policy. Pension reform."),
    ("Ursula von der Leyen","person","European Commission President. Green Deal. Ukraine support."),
]

# ── INSTITUTIONS + TREATIES ───────────────────────────────────────────────────
INSTITUTIONS_TREATIES = [
    # Financial institutions
    ("Federal Reserve",       "entity",    "US central bank. FOMC rate decisions. Dual mandate: inflation + employment."),
    ("ECB",                   "entity",    "European Central Bank. Eurozone 20 countries. 2% inflation target."),
    ("Bank of Japan",         "entity",    "BOJ. Yield Curve Control. Negative rates pioneer. Ultra-loose policy."),
    ("Bank of England",       "entity",    "BoE. Bank Rate. MPC 9 members. QE and QT operations."),
    ("PBOC",                  "entity",    "People's Bank of China. RRR and LPR tools. Managed CNY float."),
    ("Swiss National Bank",   "entity",    "SNB. CHF safe haven management. Negative rates pioneer."),
    ("IMF",                   "entity",    "IMF. 190 members. Lender of last resort. WEO biannual forecasts."),
    ("World Bank",            "entity",    "World Bank. Development finance. IBRD + IDA. 180+ country programs."),
    ("BIS",                   "entity",    "Bank for International Settlements. Basel banking standards. Central bank cooperation."),
    ("OECD",                  "entity",    "OECD. 38 members. Economic policy research. Global tax reform (Pillar 2)."),
    ("WTO",                   "entity",    "World Trade Organization. Trade dispute settlement. 164 members."),
    ("G7",                    "entity",    "G7. USA, Germany, Japan, UK, France, Italy, Canada. Annual summit."),
    ("G20",                   "entity",    "G20. 80% of global GDP. Annual summit. Macroprudential coordination."),
    ("OPEC",                  "entity",    "OPEC. 13 members. Production quotas. Saudi Arabia swing producer."),
    ("OPEC+",                 "entity",    "OPEC+. OPEC + Russia + allies. Controls ~40% global oil supply."),
    ("NATO",                  "entity",    "NATO. 32 members after Sweden joined. Article 5 collective defense."),
    ("BRICS",                 "entity",    "BRICS+. Brazil, Russia, India, China, South Africa + Egypt, UAE, Iran."),
    ("SCO",                   "entity",    "Shanghai Cooperation Organization. China-Russia security bloc."),
    ("ASEAN",                 "entity",    "ASEAN. 10 Southeast Asian nations. RCEP trade agreement."),
    ("SWIFT",                 "entity",    "SWIFT. Cross-border payment messaging. Exclusion as sanction tool."),
    ("FSB",                   "entity",    "Financial Stability Board. G20 macroprudential global watchdog."),
    ("FATF",                  "entity",    "Financial Action Task Force. AML/CFT blacklist power."),
    ("SEC",                   "entity",    "SEC. US securities regulator. Crypto enforcement. Gensler era."),
    ("CFTC",                  "entity",    "CFTC. US derivatives/futures regulator. Commodity market oversight."),
    ("FCA",                   "entity",    "Financial Conduct Authority. UK financial services regulator."),
    ("ESMA",                  "entity",    "European Securities and Markets Authority. EU markets regulator."),
    ("EBA",                   "entity",    "European Banking Authority. EU bank stress tests. Capital requirements."),
    ("SRB",                   "entity",    "Single Resolution Board. EU bank resolution mechanism."),
    ("FDIC",                  "entity",    "Federal Deposit Insurance Corporation. US bank deposit guarantee."),
    ("OCC",                   "entity",    "Office of the Comptroller of the Currency. US national bank chartering."),
    # Trade agreements
    ("USMCA",                 "concept",   "US-Mexico-Canada Agreement. NAFTA replacement. Auto rules of origin. Digital trade."),
    ("CETA",                  "concept",   "EU-Canada trade agreement. Tariff elimination. ISDS provisions."),
    ("RCEP",                  "concept",   "Regional Comprehensive Economic Partnership. 15 Asia-Pacific nations. China-led."),
    ("CPTPP",                 "concept",   "Trans-Pacific Partnership. 11 countries ex-US. Japan-led."),
    ("Belt and Road",         "concept",   "China's BRI. $1T+ infrastructure investment globally. Debt trap criticism."),
    ("Paris Agreement",       "concept",   "COP21 climate deal. 1.5°C target. NDC commitments. Article 6 carbon markets."),
    ("Basel III",             "concept",   "Bank capital and liquidity standards. CET1, LCR, NSFR requirements."),
    ("Dodd-Frank",            "concept",   "Post-2008 US financial regulation. Volcker Rule. Stress testing."),
    ("MiFID II",              "concept",   "EU financial markets regulation. Transparency, best execution, reporting."),
    ("GDPR",                  "concept",   "EU data privacy regulation. Extraterritorial effect. Fines."),
    ("IRA",                   "concept",   "Inflation Reduction Act. $369B clean energy incentives. EV credits."),
    ("CHIPS Act",             "concept",   "US CHIPS and Science Act. $52B semiconductor subsidies. Intel, TSMC plants."),
    # Financial crises / events
    ("Global Financial Crisis 2008","event","Lehman collapse. Subprime mortgage crisis. Fed QE1. $700B TARP bailout."),
    ("COVID-19 Pandemic",     "event",     "2020 global pandemic. Fed $4T QE. Fiscal stimulus $5T+. Supply chain disruption."),
    ("European Debt Crisis",  "event",     "2010-2015 eurozone sovereign debt crisis. PIIGS. Draghi 'whatever it takes'."),
    ("Russia-Ukraine War",    "event",     "February 2022 invasion. Energy crisis. Sanctions. Grain supply disruption."),
    ("SVB Collapse 2023",     "event",     "Silicon Valley Bank failure March 2023. Duration mismatch. First Twitter bank run."),
    ("Dot-com Bust 2000",     "event",     "NASDAQ -78% 2000-2002. Excessive tech valuations. Fed rate hikes 1999-2000."),
    ("Asian Financial Crisis","event",     "1997-1998 currency crisis. Thai Baht devaluation. IMF interventions. Contagion."),
    ("1970s Oil Shocks",      "event",     "OPEC embargo 1973 + Iran 1979. Stagflation era. Gold standard collapse 1971."),
    ("Plaza Accord 1985",     "event",     "G5 agreement to depreciate USD. Coordinated FX intervention. Yen appreciation."),
    ("LTCM Crisis 1998",      "event",     "Long-Term Capital Management collapse. Fed-coordinated $3.6B bailout."),
]

# ── KEY CROSS-EDGES (new node pairs) ─────────────────────────────────────────
# Format: (src_label, tgt_label, relation, evidence, weight)
V2_EDGES = [
    # Companies → sectors
    ("Apple",           "Technology Sector",  "part_of",      "AAPL is largest weight in Technology Select Sector XLK", 2.0),
    ("Microsoft",       "Technology Sector",  "part_of",      "MSFT is top weight in tech sector ETFs", 2.0),
    ("Nvidia",          "Technology Sector",  "part_of",      "NVDA semiconductor weight in tech sector", 2.0),
    ("JPMorgan Chase",  "Financial Sector",   "part_of",      "JPM is largest US bank in financial sector", 2.0),
    ("ExxonMobil",      "Energy Sector",      "part_of",      "XOM is largest US energy company in XLE", 2.0),
    ("Eli Lilly",       "Healthcare Sector",  "part_of",      "LLY largest healthcare weight driven by GLP-1 drugs", 2.0),
    # Companies → ETFs (holdings)
    ("Apple",           "QQQ",    "part_of",      "AAPL ~8% weight in Nasdaq-100 QQQ", 2.2),
    ("Apple",           "SPY",    "part_of",      "AAPL ~7% weight in S&P 500 SPY", 2.2),
    ("Apple",           "VWCE",   "part_of",      "AAPL ~4% weight in FTSE All-World VWCE", 1.8),
    ("Microsoft",       "QQQ",    "part_of",      "MSFT ~8% weight in Nasdaq-100", 2.2),
    ("Nvidia",          "QQQ",    "part_of",      "NVDA ~8% weight in QQQ after index inclusion", 2.2),
    ("TSMC",            "EMAE",   "part_of",      "TSMC ~5% weight in MSCI EM as Taiwan component", 1.9),
    ("Samsung Electronics","EMAE","part_of",      "Samsung is top EM index holding via Korea weight", 1.8),
    # Countries → ETFs
    ("United States",   "SPY",    "invests_in",   "SPY invests exclusively in US equities", 2.5),
    ("United States",   "QQQ",    "invests_in",   "QQQ invests in US Nasdaq-listed companies", 2.4),
    ("United States",   "TLT",    "invests_in",   "TLT holds 20+ year US Treasury bonds", 2.3),
    ("China",           "EMAE",   "invests_in",   "China 25%+ weight in MSCI EM ETFs", 2.0),
    ("China",           "EEM",    "invests_in",   "China largest single country in EEM", 2.0),
    ("India",           "EMAE",   "invests_in",   "India 18% weight in MSCI EM after China", 1.8),
    ("Taiwan",          "EEM",    "invests_in",   "Taiwan 16% of MSCI EM driven by TSMC weight", 1.8),
    ("European Union",  "IBGL",   "invests_in",   "IBGL holds only Eurozone government bonds", 2.3),
    # Central bankers → institutions
    ("Jerome Powell",   "Federal Reserve", "leads",     "Powell is Federal Reserve Chair since 2018", 2.5),
    ("Christine Lagarde","ECB",            "leads",     "Lagarde is ECB President since November 2019", 2.5),
    ("Kazuo Ueda",      "Bank of Japan",   "leads",     "Ueda is BOJ Governor since April 2023", 2.5),
    ("Andrew Bailey",   "Bank of England", "leads",     "Bailey is BoE Governor since March 2020", 2.5),
    ("Janet Yellen",    "Federal Reserve", "former_leader","Yellen was Fed Chair 2014-2018 before Powell", 1.8),
    ("Pan Gongsheng",   "PBOC",            "leads",     "Pan is PBOC Governor since July 2023", 2.3),
    # Key leaders → countries
    ("Xi Jinping",      "China",           "leads",     "Xi is President and CCP General Secretary", 2.5),
    ("Vladimir Putin",  "Russia",          "leads",     "Putin President of Russia since 2000 (except 2008-12)", 2.5),
    ("Donald Trump",    "United States",   "leads",     "Trump is US President for 2nd term 2025-2029", 2.5),
    ("Narendra Modi",   "India",           "leads",     "Modi is Indian PM since 2014, re-elected 2024", 2.5),
    ("Elon Musk",       "Tesla",           "leads",     "Musk is Tesla CEO and largest shareholder", 2.3),
    ("Jensen Huang",    "Nvidia",          "leads",     "Huang co-founded Nvidia in 1993, still CEO", 2.5),
    ("Sam Altman",      "AI Revolution",   "influences","Altman's OpenAI driving the AI revolution", 2.0),
    # Geopolitical → commodities
    ("Russia-Ukraine War","Oil Price",     "causes",    "Ukraine war caused energy supply disruption 2022", 2.2),
    ("Russia-Ukraine War","Natural Gas",   "causes",    "Russia cut gas flows to Europe post-invasion", 2.3),
    ("Russia-Ukraine War","Wheat",         "causes",    "Ukraine+Russia export 30% of global wheat", 2.1),
    ("Middle East",     "Oil Price",       "influences","OPEC+ production decisions drive oil prices", 2.2),
    ("OPEC",            "Oil Price",       "influences","OPEC sets production quotas affecting prices", 2.5),
    ("OPEC+",           "Oil Price",       "influences","OPEC+ expanded group controls 40% of output", 2.5),
    # Treaties → countries
    ("USMCA",           "United States",   "part_of",   "US is signatory of USMCA trade agreement", 2.0),
    ("USMCA",           "Mexico",          "part_of",   "Mexico is USMCA beneficiary, nearshoring hub", 2.0),
    ("USMCA",           "Canada",          "part_of",   "Canada in USMCA. Auto manufacturing tied.", 2.0),
    ("Belt and Road",   "China",           "part_of",   "BRI is Xi's flagship foreign policy initiative", 2.3),
    ("Belt and Road",   "Emerging Markets","influences","BRI infrastructure investments target EM countries", 1.8),
    ("Paris Agreement", "Energy Transition","causes",   "Paris COP21 goals drive global energy transition", 2.0),
    ("CHIPS Act",       "TSMC",            "influences","CHIPS Act incentivized TSMC Arizona fab investments", 2.0),
    ("CHIPS Act",       "Nvidia",          "influences","CHIPS Act supports US semiconductor ecosystem including AI chips", 1.7),
    ("IRA",             "Energy Transition","causes",   "IRA $369B clean energy spending accelerates transition", 2.0),
    # Crises → indicators
    ("Global Financial Crisis 2008","VIX",        "causes",     "GFC 2008 pushed VIX to 80. Highest ever recorded.", 2.3),
    ("COVID-19 Pandemic","Quantitative Easing",   "causes",     "COVID triggered $4T+ Fed QE and global stimulus", 2.3),
    ("European Debt Crisis","BTP",                "influences", "PIIGS crisis widened BTP-Bund spread to 575bps 2011", 2.2),
    ("SVB Collapse 2023","Bank Run",              "causes",     "SVB was first social media accelerated bank run", 2.2),
    # Technology connections
    ("AI Revolution",   "Nvidia",          "influences","AI training and inference demand drives Nvidia revenue", 2.3),
    ("AI Revolution",   "Technology Sector","influences","AI is primary driver of tech sector premium valuation", 2.0),
    ("TSMC",            "AI Revolution",   "related",   "TSMC makes GPUs that power AI revolution", 2.2),
    ("ASML",            "TSMC",            "related",   "ASML EUV is essential for TSMC advanced node production", 2.2),
    ("CHIPS Act",       "United States",   "part_of",   "US CHIPS Act domestic semiconductor policy", 2.0),
    # ETF → macro connections
    ("TLT",             "Federal Reserve", "related",   "TLT price directly inverse to Fed rate decisions", 2.2),
    ("TLT",             "Yield Curve",     "tracks",    "TLT tracks long-end of US treasury yield curve", 2.0),
    ("HYG",             "Credit Spread",   "tracks",    "HYG inverse tracks high yield credit spread", 2.2),
    ("GLD",             "Gold",            "tracks",    "GLD tracks spot gold price with 0.99+ correlation", 2.5),
    ("VWCE",            "Equity Markets",  "tracks",    "VWCE tracks FTSE All-World equity market", 2.5),
    ("IBGL",            "ECB",             "related",   "ECB rate decisions directly impact IBGL value", 2.0),
]


async def run_mega_seed_v2(batch_size: int = 50) -> Tuple[int, int]:
    """
    Populate KG with 3000+ curated nodes across all domains.
    Runs in batches to avoid DB lock. Idempotent.
    """
    from routers.knowledge_graph import upsert_node, upsert_edge
    from supabase_client import get_pool, ensure_kg_schema

    pool = await get_pool()
    await ensure_kg_schema()

    total_n = total_e = 0
    node_ids: Dict[str, int] = {}

    async def _do_upsert(label, ntype, desc, conf=0.95):
        nid = await upsert_node(label, ntype, desc, conf)
        if nid:
            node_ids[label] = nid
            return nid
        return None

    # ── 1. Companies ──
    logger.info("Mega-seed v2: upserting %d companies…", len(COMPANIES))
    for i, (ticker, name, sector, desc) in enumerate(COMPANIES):
        full_desc = f"[{ticker}] {desc}"
        nid = await _do_upsert(name, "entity", full_desc)
        if nid:
            total_n += 1
            # Also add ticker as alias node pointing to company
            await _do_upsert(ticker, "etf" if any(e[0]==ticker for e in GLOBAL_ETFS) else "entity",
                              f"Ticker: {ticker}. See: {name}")
        if i % batch_size == 0:
            await asyncio.sleep(0.05)

    # ── 2. ETFs ──
    logger.info("Mega-seed v2: upserting %d ETFs…", len(GLOBAL_ETFS))
    for i, (ticker, name, asset_class, desc) in enumerate(GLOBAL_ETFS):
        nid = await _do_upsert(ticker, "etf", f"{name}: {desc}")
        if nid:
            total_n += 1
            # Also upsert asset class node
            await _do_upsert(asset_class, "concept", f"Asset class: {asset_class}")
        if i % batch_size == 0:
            await asyncio.sleep(0.05)

    # ── 3. Countries ──
    logger.info("Mega-seed v2: upserting %d countries…", len(COUNTRIES))
    for i, (name, region, desc) in enumerate(COUNTRIES):
        nid = await _do_upsert(name, "geo", desc)
        if nid:
            total_n += 1
            await _do_upsert(region, "concept", f"Geographic/economic region: {region}")
        if i % batch_size == 0:
            await asyncio.sleep(0.05)

    # ── 4. Key people ──
    logger.info("Mega-seed v2: upserting %d people…", len(KEY_PEOPLE))
    for label, ntype, desc in KEY_PEOPLE:
        nid = await _do_upsert(label, ntype, desc)
        if nid:
            total_n += 1

    # ── 5. Institutions + Treaties ──
    logger.info("Mega-seed v2: upserting %d institutions/treaties…", len(INSTITUTIONS_TREATIES))
    for label, ntype, desc in INSTITUTIONS_TREATIES:
        nid = await _do_upsert(label, ntype, desc)
        if nid:
            total_n += 1

    # ── 6. Company → ETF edges (auto-generate for major holdings) ──
    logger.info("Mega-seed v2: creating ETF-sector edges…")
    etf_sector_map = {
        "XLK": ["Apple","Microsoft","Nvidia","Broadcom","AMD","Intel","Salesforce","Adobe"],
        "XLF": ["JPMorgan Chase","Bank of America","Goldman Sachs","Visa","Mastercard","BlackRock"],
        "XLE": ["ExxonMobil","Chevron","ConocoPhillips","SLB (Schlumberger)","NextEra Energy"],
        "XLV": ["Eli Lilly","Johnson & Johnson","UnitedHealth","AbbVie","Merck","Pfizer"],
        "XLY": ["Amazon","Tesla","McDonald's","Nike","Home Depot"],
        "XLP": ["Walmart","Costco","Target","Starbucks"],
        "SPY": ["Apple","Microsoft","Nvidia","Alphabet","Amazon","Meta"],
        "QQQ": ["Apple","Microsoft","Nvidia","Alphabet","Amazon","Meta","Tesla","Broadcom"],
        "VWCE":["Apple","Microsoft","Nvidia","Alphabet","Amazon","Meta","TSMC","Samsung Electronics","Novo Nordisk"],
    }
    for etf_ticker, companies in etf_sector_map.items():
        etf_id = node_ids.get(etf_ticker)
        if not etf_id:
            continue
        for co_name in companies:
            co_id = node_ids.get(co_name)
            if co_id:
                eid = await upsert_edge(etf_id, co_id, "holds",
                                        f"{etf_ticker} holds {co_name} as significant position", 1.8)
                if eid:
                    total_e += 1

    # ── 7. Country → region edges ──
    region_countries = {
        "G20": ["United States","China","Germany","Japan","India","United Kingdom","France","Italy",
                "Canada","Australia","Brazil","South Korea","Mexico","Indonesia","Turkey","Argentina",
                "Saudi Arabia","South Africa","Russia"],
        "European Union": ["Germany","France","Italy","Spain","Netherlands","Poland","Belgium",
                           "Sweden","Denmark","Finland","Austria","Portugal","Greece","Czech Republic",
                           "Hungary","Romania"],
        "NATO": ["United States","United Kingdom","Germany","France","Canada","Italy","Netherlands",
                 "Belgium","Norway","Denmark","Poland","Turkey"],
        "ASEAN": ["Indonesia","Thailand","Vietnam","Malaysia","Philippines","Singapore"],
        "OPEC": ["Saudi Arabia","Iran","Iraq","UAE","Kuwait","Venezuela","Nigeria","Angola"],
    }
    for org, countries in region_countries.items():
        org_id = node_ids.get(org)
        if not org_id:
            continue
        for country in countries:
            co_id = node_ids.get(country)
            if co_id:
                eid = await upsert_edge(co_id, org_id, "member_of",
                                        f"{country} is a member of {org}", 1.7)
                if eid:
                    total_e += 1

    # ── 8. V2 cross-edges ──
    logger.info("Mega-seed v2: creating %d cross-edges…", len(V2_EDGES))
    for src_l, tgt_l, rel, ev, w in V2_EDGES:
        sid = node_ids.get(src_l)
        tid = node_ids.get(tgt_l)
        if not sid:
            # Try DB lookup
            sid = await _find_node_id_v2(src_l, pool)
            if sid:
                node_ids[src_l] = sid
        if not tid:
            tid = await _find_node_id_v2(tgt_l, pool)
            if tid:
                node_ids[tgt_l] = tid
        if sid and tid:
            eid = await upsert_edge(sid, tid, rel, ev, w)
            if eid:
                total_e += 1

    logger.info("Mega-seed v2 complete: +%d nodes, +%d edges", total_n, total_e)
    return total_n, total_e


async def _find_node_id_v2(label: str, pool) -> Optional[int]:
    try:
        if pool:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT id FROM kg_nodes WHERE LOWER(label)=LOWER($1) LIMIT 1", label)
                return row["id"] if row else None
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT id FROM kg_nodes WHERE LOWER(label)=LOWER(?) LIMIT 1", (label,)
                ) as c:
                    row = await c.fetchone()
                    return row["id"] if row else None
    except Exception:
        return None
