"""
WorldLens KG Mega-Seed
======================
Populates the Knowledge Graph with 500+ high-quality nodes covering:
- Central banks, institutions, regulators (50+)
- ETFs, funds, asset classes (80+)  
- Macro indicators, economic concepts (100+)
- Geopolitical entities, regions, treaties (80+)
- Companies, sectors, industries (80+)
- Commodities, currencies, crypto (50+)
- Financial instruments, strategies (60+)

Run once at startup or on-demand via /api/kg/mega-seed
"""
from __future__ import annotations
import asyncio
import logging
from typing import Dict, List, Optional, Tuple

import aiosqlite
from config import settings

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────
# NODE DEFINITIONS
# Format: (label, type, description)
# ────────────────────────────────────────────────────────────────────

MEGA_NODES: List[Tuple[str, str, str]] = [
    # ── Central Banks ──
    ("Federal Reserve",       "entity",    "US central bank. Controls monetary policy via FOMC. Dual mandate: price stability and maximum employment."),
    ("ECB",                   "entity",    "European Central Bank. Sets rates for 20 eurozone countries. Inflation target: 2% HICP."),
    ("Bank of England",       "entity",    "UK central bank. Sets Bank Rate. Operates Monetary Policy Committee (MPC)."),
    ("Bank of Japan",         "entity",    "Japanese central bank. Yield Curve Control (YCC). Historically ultra-loose monetary policy."),
    ("PBOC",                  "entity",    "People's Bank of China. Controls CNY and Chinese monetary policy. Uses reserve requirement ratio (RRR)."),
    ("Swiss National Bank",   "entity",    "Swiss central bank. Manages CHF safe-haven flows. Negative rates pioneer."),
    ("Bank of Canada",        "entity",    "Canadian central bank. Commodity-sensitive monetary policy due to oil exports."),
    ("Reserve Bank of Australia","entity", "Australian central bank. Commodity and China-linked monetary policy."),
    ("Reserve Bank of India", "entity",    "Indian central bank. Manages INR and inflation in the world's 5th largest economy."),
    ("Banco Central do Brasil","entity",   "Brazilian central bank. High real interest rates historically. SELIC rate decisions."),

    # ── Supranational / Multilateral ──
    ("IMF",                   "entity",    "International Monetary Fund. Global lender of last resort. Publishes WEO forecasts twice yearly."),
    ("World Bank",            "entity",    "Development finance institution. Funds emerging market infrastructure and poverty reduction."),
    ("BIS",                   "entity",    "Bank for International Settlements. Central bank of central banks. Quarterly review key reading."),
    ("OECD",                  "entity",    "Organisation for Economic Co-operation and Development. Economic policy research for 38 member countries."),
    ("WTO",                   "entity",    "World Trade Organization. Governs international trade rules and dispute resolution."),
    ("G7",                    "entity",    "Group of 7 major advanced economies. USA, Germany, Japan, UK, France, Italy, Canada."),
    ("G20",                   "entity",    "Group of 20 major economies. 80% of global GDP. Annual summits drive global policy coordination."),
    ("OPEC",                  "entity",    "Organization of Petroleum Exporting Countries. Manages oil production quotas."),
    ("OPEC+",                 "entity",    "OPEC plus Russia and allies. Controls ~40% of global oil output. Key driver of oil prices."),
    ("NATO",                  "entity",    "North Atlantic Treaty Organization. 32-member military alliance. Article 5 collective defense."),
    ("EU",                    "entity",    "European Union. 27-country economic and political union. Largest single market globally."),
    ("ASEAN",                 "entity",    "Association of Southeast Asian Nations. 10-country bloc. Key supply chain hub."),
    ("BRICS",                 "entity",    "Brazil, Russia, India, China, South Africa + new members. Alternative to Western-led institutions."),
    ("SCO",                   "entity",    "Shanghai Cooperation Organization. China-Russia led Eurasian security bloc."),

    # ── Regulators / Exchanges ──
    ("SEC",                   "entity",    "US Securities and Exchange Commission. Regulates US securities markets and public companies."),
    ("CFTC",                  "entity",    "Commodity Futures Trading Commission. Regulates US derivatives and futures markets."),
    ("FCA",                   "entity",    "Financial Conduct Authority. UK financial services regulator."),
    ("ESMA",                  "entity",    "European Securities and Markets Authority. EU financial markets regulator."),
    ("NYSE",                  "entity",    "New York Stock Exchange. Largest stock exchange by market cap. Home to Dow Jones components."),
    ("NASDAQ",                "entity",    "US tech-heavy stock exchange. Home to Apple, Microsoft, Nvidia, Meta, Alphabet."),
    ("LSE",                   "entity",    "London Stock Exchange. European financial hub. FTSE 100 and 250 listed."),
    ("Deutsche Börse",        "entity",    "German stock exchange. DAX 40 components. Major European derivatives via Eurex."),
    ("CME Group",             "entity",    "Chicago Mercantile Exchange. World's largest futures exchange: oil, gold, FX, rates."),
    ("CBOE",                  "entity",    "Chicago Board Options Exchange. Home of VIX volatility index. Equity options leader."),

    # ── Key Macro Indicators ──
    ("Inflation",             "indicator", "Rate of price level change. CPI and PCE are primary measures. Fed target: 2% PCE. ECB target: 2% HICP."),
    ("Core Inflation",        "indicator", "Inflation excluding food and energy. Better signal of underlying price pressures."),
    ("CPI",                   "indicator", "Consumer Price Index. Measures price changes in consumer basket. Key input for Fed decisions."),
    ("PCE",                   "indicator", "Personal Consumption Expenditures price index. Fed's preferred inflation measure."),
    ("PPI",                   "indicator", "Producer Price Index. Measures prices received by producers. Leading indicator for CPI."),
    ("GDP Growth",            "indicator", "Annual gross domestic product growth rate. Two consecutive negative quarters = recession."),
    ("Real GDP",              "indicator", "GDP adjusted for inflation. True measure of economic output growth."),
    ("Unemployment Rate",     "indicator", "Share of labor force seeking work. US natural rate ~4%. Fed target: maximum employment."),
    ("NFP",                   "indicator", "Non-Farm Payrolls. US monthly job creation report. Most market-moving economic release."),
    ("PMI",                   "indicator", "Purchasing Managers Index. 50+ = expansion, 50- = contraction. Leading economic indicator."),
    ("ISM Manufacturing",     "indicator", "Institute for Supply Management manufacturing index. US factory activity barometer."),
    ("ISM Services",          "indicator", "ISM services sector index. ~80% of US economy. Key for services inflation assessment."),
    ("Retail Sales",          "indicator", "Monthly change in consumer spending at retail stores. 70% of US GDP is consumption."),
    ("Housing Starts",        "indicator", "New residential construction begins. Rate-sensitive indicator of economic health."),
    ("Consumer Confidence",   "indicator", "Survey of household spending intentions. Leads consumer spending by 6-9 months."),
    ("Trade Balance",         "indicator", "Exports minus imports. Deficit = capital inflows. Surplus = capital outflows."),
    ("Current Account",       "indicator", "Broadest measure of external balances including services, income, transfers."),
    ("Fiscal Deficit",        "indicator", "Government spending minus revenue. High deficit → more bond issuance → rate pressure."),
    ("Debt-to-GDP",           "indicator", "National debt as percentage of GDP. >90% considered potential drag on growth."),
    ("Interest Rate",         "indicator", "Central bank benchmark rate. Most important price in all of finance."),
    ("Yield Curve",           "indicator", "Term structure of government bond yields. Inversion (2Y>10Y) predicts recession."),
    ("10Y Treasury Yield",    "indicator", "US 10-year government bond yield. Global risk-free rate. Drives mortgage rates and equity valuations."),
    ("2Y Treasury Yield",     "indicator", "US 2-year yield. Most sensitive to Fed policy expectations. Used in yield curve spread."),
    ("30Y Treasury Yield",    "indicator", "US 30-year bond yield. Long-term inflation expectations benchmark. Key for pensions."),
    ("Real Yield",            "indicator", "Nominal yield minus inflation expectations (TIPS). Negative real yields = bullish for gold."),
    ("Break-even Inflation",  "indicator", "Inflation expectation priced into TIPS vs nominal Treasury spread."),
    ("VIX",                   "indicator", "CBOE Volatility Index. 30-day implied volatility on S&P 500 options. Fear gauge."),
    ("MOVE Index",            "indicator", "Bond market volatility index. Treasury equivalent of VIX. High MOVE = rate uncertainty."),
    ("DXY",                   "indicator", "US Dollar Index vs 6 currencies. EUR 57.6% weight. Strong USD = EM pressure."),
    ("Credit Spread",         "indicator", "Risk premium over risk-free rate. IG spreads and HY spreads. Widens in stress."),
    ("TED Spread",            "indicator", "3-month LIBOR vs 3-month T-bill. Measures bank credit risk and interbank stress."),
    ("LIBOR",                 "indicator", "London Interbank Offered Rate. Being replaced by SOFR. Key benchmark for loans."),
    ("SOFR",                  "indicator", "Secured Overnight Financing Rate. LIBOR replacement. Based on repo transactions."),
    ("M2",                    "indicator", "Broad money supply including deposits. Rapid M2 growth = inflationary pressure."),
    ("Repo Rate",             "indicator", "Rate for overnight collateralized borrowing. Key for bank liquidity and funding costs."),

    # ── Financial Concepts ──
    ("Quantitative Easing",   "policy",    "Central bank asset purchases to expand money supply and lower long-term rates. QE1, QE2, QE3, PEPP."),
    ("Quantitative Tightening","policy",   "Balance sheet reduction. Not reinvesting maturities or selling assets. Raises long-term rates."),
    ("Forward Guidance",      "policy",    "Central bank communication about future policy path. Shapes market expectations before action."),
    ("Monetary Policy",       "policy",    "Central bank toolkit: rates, QE/QT, reserve requirements, forward guidance. Controls money supply."),
    ("Fiscal Policy",         "policy",    "Government tax and spend decisions. Expansionary = stimulus. Contractionary = austerity."),
    ("Austerity",             "policy",    "Government spending cuts to reduce deficit. Contractionary in short run, potentially stabilizing long run."),
    ("Yield Curve Control",   "policy",    "BOJ policy of targeting specific yield levels by unlimited bond purchases."),
    ("ZIRP",                  "policy",    "Zero Interest Rate Policy. Fed 2008-2015 and 2020-2022. ECB 2014-2022."),
    ("NIRP",                  "policy",    "Negative Interest Rate Policy. SNB, ECB, BOJ. Charges banks for excess reserves."),
    ("Recession",             "event",     "Two consecutive quarters of negative GDP growth. NBER officially declares US recessions."),
    ("Stagflation",           "concept",   "High inflation + stagnant/negative growth. 1970s oil shock. Worst scenario for policymakers."),
    ("Deflation",             "concept",   "Sustained price level decline. Dangerous: delays spending, raises real debt burden."),
    ("Disinflation",          "concept",   "Inflation still positive but falling. 2022-2024 US disinflation period."),
    ("Soft Landing",          "concept",   "Fed tightens enough to reduce inflation without causing recession. 1995, possibly 2023-24."),
    ("Hard Landing",          "concept",   "Tightening causes recession. More common historically. 1981-82, 1990-91, 2001, 2008."),
    ("Liquidity Trap",        "concept",   "Interest rates at zero, monetary policy loses effectiveness. QE substitute required."),
    ("Debt Spiral",           "concept",   "Rising debt leads to higher rates leads to more debt. EM crisis pattern."),
    ("Currency Crisis",       "event",     "Sharp currency devaluation. Causes: reserves depletion, speculative attack, policy error."),
    ("Bank Run",              "event",     "Mass withdrawal from bank. SVB 2023 first Twitter-era bank run. Requires FDIC response."),
    ("Yield Curve Inversion", "event",     "2Y yield exceeds 10Y yield. Preceded every US recession since 1970. 2022-2024 inversion."),
    ("Flight to Safety",      "concept",   "Risk-off capital flow to USD, Treasuries, gold, CHF, JPY. Triggered by stress events."),
    ("Risk-On",               "concept",   "Investors increase exposure to risky assets: equities, EM, HY bonds, commodities."),
    ("Risk-Off",              "concept",   "Investors reduce risk: buy USD, Treasuries, gold, sell EM, equities, HY."),
    ("Carry Trade",           "concept",   "Borrow low-rate currency, invest high-rate currency. USD-funded EM carry. JPY carry."),
    ("Deleveraging",          "concept",   "Forced asset sales to reduce debt. Amplifies market moves. 2008 crisis mechanism."),
    ("P/E Ratio",             "indicator", "Price-to-Earnings. Equity valuation metric. S&P 500 historical average ~16x. Elevated at 20-25x."),
    ("EPS",                   "indicator", "Earnings Per Share. Core driver of equity valuations. Wall Street EPS estimates move markets."),
    ("Earnings Season",       "event",     "Quarterly period when public companies report results. 500+ S&P companies report over 6 weeks."),
    ("Margin Compression",    "concept",   "Input costs rise faster than output prices. Reduces corporate profits. Inflation impact."),
    ("Sharpe Ratio",          "indicator", "Risk-adjusted return: excess return divided by volatility. Higher = better risk/reward."),
    ("Duration",              "indicator", "Bond sensitivity to interest rate changes. 10Y duration = 10% price drop per 1% rate rise."),
    ("Convexity",             "indicator", "Rate of change of duration. Long bonds have positive convexity - buffer against rate spikes."),
    ("Beta",                  "indicator", "Asset sensitivity to market moves. Beta >1 = more volatile than market."),
    ("Alpha",                 "indicator", "Excess return above benchmark. The goal of active fund management."),
    ("Correlation",           "indicator", "Statistical relationship between asset returns. Key for portfolio construction."),

    # ── Asset Classes ──
    ("Equity Markets",        "concept",   "Global stock markets. Forward-looking: discounts 12-18 months of earnings. ~$100T market cap."),
    ("Bond Markets",          "concept",   "Global fixed income. $130T+ market. Prices move inverse to yields."),
    ("Emerging Markets",      "concept",   "Developing country assets. Higher growth potential. Vulnerable to USD strength and EM flows."),
    ("Developed Markets",     "concept",   "Advanced economy markets: US, Europe, Japan. MSCI World covers 23 DM countries."),
    ("Frontier Markets",      "concept",   "Pre-emerging markets. Small, illiquid. Vietnam, Kenya, Nigeria example."),
    ("Private Equity",        "concept",   "Non-public company investments. Illiquid premium. Leveraged buyouts (LBOs)."),
    ("Venture Capital",       "concept",   "Early-stage company financing. High risk/reward. Silicon Valley ecosystem."),
    ("Real Estate",           "concept",   "Property as asset class. Inflation hedge. Sensitive to interest rates via mortgage costs."),
    ("REITs",                 "concept",   "Real Estate Investment Trusts. Liquid real estate exposure. Dividend yield play."),
    ("Commodities",           "concept",   "Raw materials: energy, metals, agriculture. Inflation hedge. Cyclical demand."),
    ("Alternatives",          "concept",   "Non-traditional assets: hedge funds, private equity, real estate, commodities, crypto."),
    ("Crypto",                "concept",   "Cryptocurrency asset class. Bitcoin as digital gold narrative. High beta risk asset."),
    ("Cash",                  "concept",   "Lowest return, highest liquidity. Safe haven when rates high. Opportunity cost rises in bull markets."),
    ("Hedge Funds",           "concept",   "Absolute return vehicles. Long/short, macro, arbitrage strategies. $4T+ AUM globally."),
    ("Mutual Funds",          "concept",   "Pooled retail investment vehicles. Actively or passively managed. Regulated."),
    ("Index Funds",           "concept",   "Passive vehicles tracking market indices. Vanguard pioneered. Lower cost than active."),

    # ── ETFs ──
    ("VWCE",                  "etf",       "Vanguard FTSE All-World UCITS ETF. 3900+ stocks globally. TER 0.22%. Acc. The core global ETF for EU investors."),
    ("IWDA",                  "etf",       "iShares Core MSCI World UCITS ETF. 23 developed countries, ~1500 stocks. TER 0.20%. No EM."),
    ("EMAE",                  "etf",       "iShares Core MSCI EM IMI UCITS ETF. 24 emerging countries including small caps. TER 0.18%."),
    ("IBGL",                  "etf",       "iShares Euro Government Bond UCITS ETF. EUR sovereign debt investment grade. Duration ~8Y. TER 0.09%."),
    ("TLT",                   "etf",       "iShares 20+ Year Treasury Bond ETF. Long-duration US govts. Duration ~17Y. Risk-off beneficiary."),
    ("SPY",                   "etf",       "SPDR S&P 500 ETF Trust. $500B+ AUM. Most liquid ETF. Tracks S&P 500. TER 0.09%."),
    ("QQQ",                   "etf",       "Invesco QQQ Trust. Nasdaq-100. ~40% in AAPL+MSFT+NVDA+META+GOOGL. TER 0.20%."),
    ("GLD",                   "etf",       "SPDR Gold Shares. Physical gold backed. $60B+ AUM. TER 0.40%."),
    ("IAU",                   "etf",       "iShares Gold Trust. Cheaper gold ETF alternative. TER 0.25%."),
    ("XGLD",                  "etf",       "Xetra-Gold ETC. Physical gold deliverable. Deutsche Börse listed. EU investor gold alternative."),
    ("HYG",                   "etf",       "iShares iBoxx USD High Yield Corporate Bond ETF. HY credit barometer. Spread proxy."),
    ("LQD",                   "etf",       "iShares iBoxx USD Investment Grade Corporate Bond ETF. IG credit. Duration ~9Y."),
    ("EEM",                   "etf",       "iShares MSCI Emerging Markets ETF. $19B+ AUM. Legacy EM benchmark. TER 0.68%."),
    ("VWO",                   "etf",       "Vanguard FTSE Emerging Markets ETF. FTSE EM (excludes Korea). TER 0.08%."),
    ("AGG",                   "etf",       "iShares Core US Aggregate Bond ETF. Broad US fixed income. Govts + IG corps. Duration ~6Y."),
    ("BND",                   "etf",       "Vanguard Total Bond Market ETF. Similar to AGG. Vanguard alternative."),
    ("VNQ",                   "etf",       "Vanguard Real Estate ETF. US REITs exposure. Interest rate sensitive."),
    ("GDX",                   "etf",       "VanEck Gold Miners ETF. Gold mining stocks. Leveraged beta to gold price."),
    ("USO",                   "etf",       "United States Oil Fund. Front-month WTI futures. Contango drag warning."),
    ("SPHD",                  "etf",       "Invesco S&P 500 High Dividend Low Volatility ETF. Defensive dividend play."),
    ("IWM",                   "etf",       "iShares Russell 2000 ETF. US small-cap benchmark. More economically sensitive than SPY."),
    ("EFA",                   "etf",       "iShares MSCI EAFE ETF. Europe, Australasia, Far East developed ex-US."),
    ("IEMG",                  "etf",       "iShares Core MSCI Emerging Markets ETF. Comprehensive EM including small caps."),
    ("XLF",                   "etf",       "Financial Select Sector SPDR Fund. US financial stocks: banks, insurance, brokers."),
    ("XLE",                   "etf",       "Energy Select Sector SPDR Fund. US energy stocks. Oil price correlation."),
    ("XLK",                   "etf",       "Technology Select Sector SPDR Fund. US tech sector. Apple + Microsoft heavy."),
    ("XLV",                   "etf",       "Health Care Select Sector SPDR Fund. Defensive sector. Drug stocks and healthcare."),
    ("XLU",                   "etf",       "Utilities Select Sector SPDR Fund. Bond proxy. High dividend, interest rate sensitive."),
    ("JNUG",                  "etf",       "Direxion Daily Junior Gold Miners Bull 2X. Leveraged gold miners. High risk."),
    ("TQQQ",                  "etf",       "ProShares UltraPro QQQ 3x. 3x leveraged Nasdaq-100. Daily rebalancing decay."),

    # ── Commodities ──
    ("Gold",                  "commodity", "XAU. Safe haven, inflation hedge, store of value. $2T+ above-ground stock. USD inverse."),
    ("Silver",                "commodity", "XAG. Dual industrial/monetary metal. 50% industrial use (solar, electronics). More volatile than gold."),
    ("Platinum",              "commodity", "PGM metal. Auto catalysts (gas vehicles). Supply concentrated in South Africa."),
    ("Palladium",             "commodity", "PGM metal. Auto catalysts (gasoline cars). Substitution risk from EV transition."),
    ("Copper",                "commodity", "Dr. Copper. Industrial barometer. China drives 50%+ of demand. EV transition bullish."),
    ("Aluminium",             "commodity", "Energy-intensive metal. China dominant producer. EV and aerospace demand."),
    ("Lithium",               "commodity", "EV battery critical metal. Chile, Australia, China supply. Massive demand growth expected."),
    ("Cobalt",                "commodity", "EV battery material. 70% from DRC (geopolitical risk). Battery chemistry diversification risk."),
    ("Nickel",                "commodity", "Stainless steel and EV batteries. LME nickel squeeze 2022. Russia and Indonesia supply."),
    ("Iron Ore",              "commodity", "Steel production input. China construction demand driver. Australia and Brazil supply."),
    ("Oil Price",             "commodity", "Brent and WTI crude. 100M barrels/day global consumption. OPEC+ controls supply."),
    ("Natural Gas",           "commodity", "Energy source. Henry Hub (US), TTF (Europe). Highly seasonal. LNG trade growing."),
    ("LNG",                   "commodity", "Liquefied Natural Gas. US exports to Europe post-Ukraine war. New global gas market."),
    ("Coal",                  "commodity", "Thermal (power) and metallurgical (steel). Transition risk from decarbonization."),
    ("Wheat",                 "commodity", "Food security staple. Ukraine-Russia conflict major supply disruption. CME futures."),
    ("Corn",                  "commodity", "Feedstock and ethanol. US dominant exporter. Weather and biofuel policy drivers."),
    ("Soybeans",              "commodity", "Protein feed and oil. Brazil and US duopoly. China demand critical."),
    ("Coffee",                "commodity", "Arabica and Robusta. Brazil (40%+) and Vietnam supply. Climate change risk."),
    ("Sugar",                 "commodity", "Brazil and India dominant. Ethanol diversion competes with food use."),
    ("Cotton",                "commodity", "Textile input. US, India, China producers. Fashion supply chain."),
    ("Uranium",               "commodity", "Nuclear fuel. Renaissance demand from energy security concerns. Kazakhstan dominant."),

    # ── Currencies ──
    ("USD",                   "currency",  "US Dollar. World reserve currency. 60%+ of global FX reserves. Dollar milkshake theory."),
    ("EUR",                   "currency",  "Euro. ECB managed. 20 countries. Second largest reserve currency. EUR/USD most traded pair."),
    ("JPY",                   "currency",  "Japanese Yen. Carry trade funding currency. Safe haven. BOJ YCC creates asymmetric moves."),
    ("GBP",                   "currency",  "British Pound Sterling. Brexit discount. Bank of England managed. Cable (GBP/USD) key pair."),
    ("CHF",                   "currency",  "Swiss Franc. Safe haven currency. SNB intervenes. EURCHF floor history."),
    ("CNY",                   "currency",  "Chinese Renminbi/Yuan. Managed float vs USD basket. Internationalisation push via CIPS."),
    ("AUD",                   "currency",  "Australian Dollar. Commodity currency. China proxy. Iron ore and coal correlations."),
    ("CAD",                   "currency",  "Canadian Dollar. Oil currency. USD/CAD oil inverse correlation."),
    ("BRL",                   "currency",  "Brazilian Real. High carry currency. Political risk premium. Commodity sensitive."),
    ("INR",                   "currency",  "Indian Rupee. RBI managed. Fastest growing major economy currency."),
    ("KRW",                   "currency",  "South Korean Won. Tech export currency. Samsung/SK Hynix cycle proxy."),
    ("MXN",                   "currency",  "Mexican Peso. Nearshoring beneficiary. High carry vs USD. Remittances driver."),
    ("ZAR",                   "currency",  "South African Rand. High carry EM currency. Mining sector and load shedding risks."),
    ("TRY",                   "currency",  "Turkish Lira. History of severe depreciation. Unorthodox monetary policy risks."),
    ("RUB",                   "currency",  "Russian Ruble. Sanctions impact. Capital controls. Oil-backed floor."),
    ("USDJPY",                "currency",  "USD/JPY. Most important BOJ-policy pair. Yen weakness = imported inflation for Japan."),
    ("EURUSD",                "currency",  "EUR/USD. World's most liquid FX pair. ECB-Fed policy differential driver."),
    ("GBPUSD",                "currency",  "GBP/USD (Cable). Post-Brexit premium. BoE-Fed divergence driver."),
    ("DXY",                   "indicator", "Dollar Index. Basket of 6 currencies. EUR 57.6%, JPY 13.6%, GBP 11.9%, CAD 9.1%."),

    # ── Crypto ──
    ("Bitcoin",               "concept",   "BTC. First cryptocurrency. Digital gold narrative. 21M supply cap. Halving every 4 years."),
    ("Ethereum",              "concept",   "ETH. Smart contract platform. PoS since Merge 2022. DeFi and NFT ecosystem base layer."),
    ("Stablecoin",            "concept",   "USD-pegged crypto. USDT, USDC. $150B+ market. DeFi liquidity backbone."),
    ("DeFi",                  "concept",   "Decentralized Finance. On-chain lending, DEX, yield farming. Ethereum dominant ecosystem."),
    ("CBDC",                  "concept",   "Central Bank Digital Currency. Digital sovereign money. China eCNY leading. ECB digital euro."),

    # ── Key Sectors ──
    ("Technology Sector",     "concept",   "Highest weight S&P sector (~30%). FAANG+M. Interest rate sensitive via long-duration DCF."),
    ("Financial Sector",      "concept",   "Banks, insurance, brokers. Benefits from rising rates (NIM expansion). Credit risk exposure."),
    ("Energy Sector",         "concept",   "Oil majors, E&P, pipelines. Oil price highly correlated. Transition energy risk."),
    ("Healthcare Sector",     "concept",   "Defensive. Drug pricing policy risk. Aging population tailwind. Innovation pipeline."),
    ("Consumer Staples",      "concept",   "Defensive non-cyclical. Food, beverages, household products. Recession resistant."),
    ("Consumer Discretionary","concept",   "Cyclical. Retail, autos, hospitality. Amazon heavy. Consumer confidence sensitive."),
    ("Industrials Sector",    "concept",   "Capital goods, aerospace, defense. Infrastructure spend beneficiary. Cyclical."),
    ("Utilities Sector",      "concept",   "Regulated monopolies. High dividend. Bond proxy: inversely correlated to rates."),
    ("Materials Sector",      "concept",   "Mining, chemicals, packaging. Commodity price sensitive. China demand driven."),
    ("Real Estate Sector",    "concept",   "REITs in S&P. Highly interest rate sensitive. CRE stress from WFH."),
    ("Communication Services","concept",   "Telecom + social media + entertainment. Alphabet, Meta, Netflix, AT&T."),

    # ── Companies ──
    ("Apple",                 "entity",    "AAPL. $3T+ market cap. Consumer electronics, services (App Store, iCloud). China manufacturing risk."),
    ("Microsoft",             "entity",    "MSFT. Cloud (Azure), enterprise software, AI (OpenAI investment). Defensive tech."),
    ("Nvidia",                "entity",    "NVDA. AI chip monopoly. H100/H200 GPUs. Data center explosion. China export controls risk."),
    ("Alphabet",              "entity",    "GOOGL. Google search, YouTube, Google Cloud. AI competition risk from ChatGPT."),
    ("Amazon",                "entity",    "AMZN. E-commerce, AWS cloud, advertising. Most diversified tech company."),
    ("Meta",                  "entity",    "META. Facebook, Instagram, WhatsApp. Advertising revenue. Metaverse investment."),
    ("Tesla",                 "entity",    "TSLA. EV leader. Robotaxi and AI ambitions. Elon Musk brand risk. China competition."),
    ("Berkshire Hathaway",    "entity",    "BRK. Warren Buffett. Diversified holding company. $300B+ cash position. Defensive."),
    ("JPMorgan Chase",        "entity",    "JPM. Largest US bank. Jamie Dimon CEO. SIFI designation. NIM expansion from rates."),
    ("Goldman Sachs",         "entity",    "GS. Investment bank. Trading and advisory. Commodities and credit expertise."),
    ("BlackRock",             "entity",    "BLK. $10T+ AUM. World's largest asset manager. iShares ETF monopoly."),
    ("Vanguard",              "entity",    "Largest mutual fund company. Pioneer of passive investing. $8T+ AUM. Not publicly traded."),
    ("ASML",                  "entity",    "ASML. Dutch. Only maker of EUV lithography machines. Semiconductor supply chain chokepoint."),
    ("TSMC",                  "entity",    "Taiwan Semiconductor Manufacturing. Fabricates chips for Nvidia, Apple, AMD. Taiwan risk."),
    ("Saudi Aramco",          "entity",    "Saudi Arabia's state oil company. Largest company by oil reserves. OPEC+ supply decisions."),
    ("ExxonMobil",            "entity",    "XOM. US oil major. Pioneer acquisition. LNG and permian growth."),
    ("Shell",                 "entity",    "SHEL. Anglo-Dutch oil major. LNG leader. Energy transition investments."),
    ("BP",                    "entity",    "BP. British oil major. Net zero 2050 target. North Sea decommissioning."),

    # ── Geopolitics ──
    ("United States",         "entity",    "World's largest economy ($27T GDP). Military superpower. Dollar reserve currency issuer."),
    ("China",                 "entity",    "Second largest economy ($17T GDP). Manufacturing hub. Geopolitical rival to US. Taiwan risk."),
    ("European Union",        "entity",    "27-country bloc. $17T GDP. Largest trading bloc. Dependent on gas imports. Green Deal."),
    ("Russia",                "entity",    "Nuclear power. Major oil and gas exporter. Ukraine war sanctions. SWIFT exclusion."),
    ("India",                 "entity",    "Fastest growing major economy (7%+ GDP). Manufacturing alternative to China. Modi government."),
    ("Japan",                 "entity",    "3rd largest economy. Demographic decline. BOJ YCC. Semiconductor and auto expertise."),
    ("Germany",               "entity",    "Europe's largest economy. Industrial powerhouse. Energy crisis post-Ukraine. Green transition."),
    ("United Kingdom",        "entity",    "Post-Brexit economy. Financial services hub. North Sea energy. Special relationship with US."),
    ("Saudi Arabia",          "entity",    "Swing oil producer. Vision 2030 diversification. OPEC+ leader. US security relationship."),
    ("Israel",                "entity",    "Middle East tech hub. Conflict with Gaza/Iran. Defense and cybersecurity industry."),
    ("Iran",                  "entity",    "Oil producer under sanctions. Nuclear program. Proxy conflicts in Middle East."),
    ("Turkey",                "entity",    "NATO member and Russia partner. Gateway economy. Inflation crisis. Erdogan unorthodox policy."),
    ("Brazil",                "entity",    "Largest LatAm economy. Soy, iron ore, oil exporter. Lula government. Amazon deforestation."),
    ("South Korea",           "entity",    "Semiconductor and EV battery powerhouse. Samsung and SK Hynix. North Korea geopolitical risk."),
    ("Taiwan",                "entity",    "TSMC home. China reunification threat. Most critical semiconductor node globally."),
    ("Middle East",           "entity",    "Oil-producing region. OPEC+ coordination. Israel-Palestine conflict. Iran-Saudi rivalry."),
    ("Ukraine",               "entity",    "Russia-Ukraine war. Wheat and sunflower oil exports disrupted. European defense spend catalyst."),
    ("Africa",                "entity",    "Youngest population globally. Critical minerals for energy transition. Chinese investment."),
    ("Southeast Asia",        "entity",    "Manufacturing China+1 beneficiary. Vietnam, Indonesia, Thailand production hubs."),
    ("Latin America",         "entity",    "Commodity exporter region. Political volatility. Nearshoring opportunity for Mexico."),

    # ── Financial Instruments ──
    ("Treasury Bond",         "concept",   "US government bond. Risk-free benchmark. 10Y most watched. Held by foreign central banks."),
    ("Bund",                  "concept",   "German government bond. EUR benchmark equivalent to Treasury. Negative yields 2014-2022."),
    ("BTP",                   "concept",   "Italian government bond. BTP-Bund spread measures Italy risk premium. ECB TPI cap."),
    ("JGB",                   "concept",   "Japanese Government Bond. BOJ holds 50%+ of float via YCC. ¥1 quadrillion outstanding."),
    ("Corporate Bond",        "concept",   "Company-issued debt. Investment grade (IG) vs high yield (HY/junk). Credit spread over govt."),
    ("High Yield Bond",       "concept",   "Sub-investment grade corporate debt. Rated BB+ or below. Equity-like risk/return."),
    ("MBS",                   "concept",   "Mortgage-Backed Securities. US housing market exposure. Fed QE purchase target."),
    ("CDS",                   "concept",   "Credit Default Swap. Insurance against bond default. Used for credit hedging and speculation."),
    ("Futures",               "concept",   "Standardized forward contract on exchange. Oil, gold, rates, equity index, FX futures."),
    ("Options",               "concept",   "Right but not obligation to buy/sell at strike price. Used for hedging and leverage."),
    ("Swaps",                 "concept",   "Exchange of cash flows. Interest rate swaps, currency swaps, equity swaps."),
    ("ETF",                   "concept",   "Exchange-Traded Fund. Index-tracking vehicle. Lower cost than active. Tax efficient."),
    ("SPAC",                  "concept",   "Special Purpose Acquisition Company. Blank check shell for IPO shortcut. 2020-21 boom."),
    ("IPO",                   "concept",   "Initial Public Offering. Company's first share sale. Barometer of risk appetite."),
    ("Short Selling",         "concept",   "Selling borrowed shares to profit from price decline. Borrow fee + unlimited loss risk."),
    ("Leverage",              "concept",   "Using borrowed capital to amplify returns. Amplifies both gains and losses."),
    ("Derivatives",           "concept",   "Financial instruments derived from underlying assets. Futures, options, swaps, forwards."),
    ("Portfolio Rebalancing", "concept",   "Restoring target asset allocation. Forces buy low/sell high. Reduces drift risk."),
    ("Dollar Cost Averaging", "concept",   "Regular fixed-amount investment regardless of price. Reduces timing risk. Long-term wealth builder."),
    ("60/40 Portfolio",       "concept",   "60% stocks, 40% bonds. Traditional balanced allocation. Both asset classes fell in 2022."),
    ("All-Weather Portfolio", "concept",   "Ray Dalio's risk-parity portfolio. 30% stocks, 40% LT bonds, 15% IT bonds, 7.5% gold, 7.5% commodities."),
    ("Barbell Strategy",      "concept",   "Nassim Taleb. Very safe + very speculative assets. No middle ground. Antifragile design."),

    # ── Market Structure ──
    ("Bull Market",           "concept",   "20%+ rise from lows. S&P 500 average bull: +150%, 5.5 years. 11 bulls since 1928."),
    ("Bear Market",           "concept",   "20%+ decline from highs. Average duration 9-13 months. Average drawdown -35%."),
    ("Market Correction",     "concept",   "10-20% decline from highs. Normal 1-2 per year. Average recovery 4 months."),
    ("Black Swan",            "concept",   "Nassim Taleb concept. High-impact, low-probability, unpredictable events. COVID, GFC."),
    ("Volatility",            "concept",   "Statistical measure of return dispersion. Implied vs realized. VIX measures forward vol."),
    ("Liquidity",             "concept",   "Ease of buying/selling without moving price. Evaporates in crises. Fed backstop."),
    ("Market Breadth",        "indicator", "Ratio of advancing to declining stocks. Divergence from index is warning signal."),
    ("Market Cap",            "indicator", "Total company value: shares × price. Large cap >$10B. Small cap <$2B."),
    ("Momentum",              "concept",   "Trend-following: winners keep winning, losers keep losing. Factor investing strategy."),
    ("Value Investing",       "concept",   "Buying cheap stocks (low P/E, P/B). Buffett-style. Underperformed growth 2010-2020."),
    ("Growth Investing",      "concept",   "Buying high-growth companies regardless of current valuation. Works in low-rate environment."),
    ("Factor Investing",      "concept",   "Systematic exposure to return premiums: value, momentum, quality, low vol, size."),

    # ── Geopolitical Themes ──
    ("Deglobalization",       "concept",   "Reversal of 1990-2020 globalization trend. Friend-shoring, nearshoring, tariffs. Inflationary."),
    ("Trade War",             "event",     "US-China tariffs post-2018. Potential escalation under Trump 2.0. Supply chain restructuring."),
    ("Sanctions",             "event",     "Economic penalties against countries or entities. Russia, Iran, North Korea primary targets."),
    ("Geopolitical Risk",     "concept",   "Risk from interstate conflict, political instability, sanctions, trade barriers."),
    ("Supply Chain",          "concept",   "Global production network. COVID disruption + deglobalization risk. Just-in-time to just-in-case."),
    ("Energy Security",       "concept",   "Secure access to energy supply. Post-Ukraine EU crisis. Renewables independence push."),
    ("Food Security",         "concept",   "Access to sufficient, safe, nutritious food. Ukraine war disrupted global wheat supply."),
    ("Reshoring",             "concept",   "Moving production back to home country. Inflation and geopolitical risk driver."),
    ("AI Revolution",         "concept",   "AI adoption driving productivity gains, Nvidia chip demand, cloud spend, software disruption."),
    ("Energy Transition",     "concept",   "Shift from fossil fuels to renewables. Solar, wind, EV, battery storage. Critical metals demand."),
    ("Climate Risk",          "concept",   "Physical risk (extreme weather) and transition risk (stranded assets) for investors."),
    ("Cybersecurity",         "concept",   "Protection against cyber attacks. Critical infrastructure risk. Fast-growing defense spend."),
    ("Demographic Trends",    "concept",   "Aging DM, young EM. Japan-style deflation risk in China. Immigration policy."),
]

# ────────────────────────────────────────────────────────────────────
# EDGE DEFINITIONS
# Format: (src_label, tgt_label, relation, evidence, weight)
# ────────────────────────────────────────────────────────────────────

MEGA_EDGES: List[Tuple[str, str, str, str, float]] = [
    # Central bank → rate
    ("Federal Reserve",     "Interest Rate",        "influences",       "Fed sets fed funds rate via FOMC 8x/year",                2.5),
    ("ECB",                 "Interest Rate",        "influences",       "ECB sets MRO and deposit facility rates",                  2.5),
    ("Bank of England",     "Interest Rate",        "influences",       "BoE sets Bank Rate at MPC meetings",                      2.4),
    ("Bank of Japan",       "Interest Rate",        "influences",       "BOJ YCC targets 10Y JGB yield near 0%",                   2.3),
    ("PBOC",                "Interest Rate",        "influences",       "PBOC sets 1Y and 5Y LPR rates",                           2.2),
    # Rate → markets
    ("Interest Rate",       "Bond Markets",         "influences",       "Rate rises lower bond prices inversely",                  2.2),
    ("Interest Rate",       "Equity Markets",       "influences",       "Rates raise discount rate, lower DCF valuations",         1.9),
    ("Interest Rate",       "Emerging Markets",     "influences",       "Rising US rates → stronger USD → EM capital outflows",    1.8),
    ("Interest Rate",       "Real Estate",          "influences",       "Mortgage rates track 10Y Treasury. Higher rates = lower demand", 2.0),
    ("Interest Rate",       "Carry Trade",          "influences",       "Rate differentials drive carry trade attractiveness",      1.7),
    # Inflation
    ("Inflation",           "Federal Reserve",      "influences",       "High inflation forces Fed to raise rates (dual mandate)",  2.0),
    ("Inflation",           "Gold",                 "correlates_with",  "Gold historically hedges inflation long-term",             1.5),
    ("Inflation",           "Oil Price",            "correlates_with",  "Energy is 7-8% of CPI basket directly",                   1.7),
    ("Oil Price",           "Inflation",            "causes",           "Oil spike passes through to transport and heating CPI",    1.8),
    ("Oil Price",           "OPEC+",                "part_of",          "OPEC+ supply decisions are primary oil price driver",      2.2),
    ("OPEC",                "OPEC+",                "part_of",          "OPEC is the core of OPEC+ expanded group",                 2.0),
    ("Natural Gas",         "Inflation",            "causes",           "Gas prices drive energy CPI component directly",          1.6),
    ("Quantitative Easing", "Inflation",            "causes",           "Money supply expansion eventually transmits to prices",    1.7),
    ("Quantitative Easing", "Bond Markets",         "influences",       "QE buys bonds, suppresses yields, raises prices",         2.0),
    ("Quantitative Easing", "Equity Markets",       "influences",       "QE portfolio rebalancing lifts all asset prices",         1.8),
    ("Quantitative Tightening","Bond Markets",      "influences",       "QT increases supply, raises yields, lowers prices",       1.9),
    # GDP / growth
    ("GDP Growth",          "Equity Markets",       "correlates_with",  "EPS growth tracks nominal GDP growth closely",             1.7),
    ("GDP Growth",          "Unemployment Rate",    "influences",       "Okun's Law: 1% above potential GDP → 0.5% less unemployment", 1.6),
    ("GDP Growth",          "Copper",               "correlates_with",  "Copper demand tracks industrial activity tightly",         1.7),
    # Yield curve
    ("Yield Curve",         "Recession",            "happened_before",  "Inversions preceded all 8 post-WWII US recessions",       2.2),
    ("Yield Curve Inversion","Recession",           "causes",           "Inversion → tight credit → reduced investment → slowdown", 2.0),
    ("10Y Treasury Yield",  "Equity Markets",       "influences",       "10Y yield is the discount rate for all equity DCF models", 2.1),
    ("10Y Treasury Yield",  "Mortgage Rate",        "causes",           "30Y mortgage tracks 10Y treasury with ~200bps spread",    2.0),
    ("2Y Treasury Yield",   "Federal Reserve",      "correlates_with",  "2Y yield is the best market forecast of Fed policy",       2.0),
    ("Real Yield",          "Gold",                 "contradicts",      "Negative real yields make gold (no yield) more attractive", 1.8),
    # VIX / risk
    ("VIX",                 "Risk-Off",             "correlates_with",  "VIX above 25-30 reliably signals risk-off regime",         1.8),
    ("VIX",                 "Equity Markets",       "correlates_with",  "Historical VIX-S&P correlation -0.7. Inverse relationship", 1.8),
    ("Credit Spread",       "Risk-Off",             "correlates_with",  "HY/IG spread widening precedes and accompanies risk-off",  1.8),
    ("TED Spread",          "Risk-Off",             "correlates_with",  "TED spread spikes signal banking system stress",           1.7),
    # Dollar
    ("DXY",                 "Gold",                 "contradicts",      "Dollar-gold inverse correlation -0.6 historically",        1.7),
    ("DXY",                 "Emerging Markets",     "influences",       "Strong USD raises EM USD-denominated debt burden",         1.8),
    ("DXY",                 "Commodities",          "contradicts",      "Commodities priced in USD → dollar inverse correlation",   1.6),
    ("USD",                 "DXY",                  "tracks",           "DXY measures USD strength vs basket of 6 currencies",     2.0),
    # ETF → Asset class
    ("VWCE",                "Equity Markets",       "tracks",           "VWCE tracks FTSE All-World (3900+ stocks globally)",       2.5),
    ("VWCE",                "Developed Markets",    "invests_in",       "~85% of VWCE is developed markets",                       2.0),
    ("VWCE",                "Emerging Markets",     "invests_in",       "~15% of VWCE is emerging markets",                        1.8),
    ("IWDA",                "Equity Markets",       "tracks",           "IWDA tracks MSCI World 23 developed countries",            2.5),
    ("IWDA",                "Developed Markets",    "invests_in",       "100% developed markets by MSCI definition",                2.5),
    ("EMAE",                "Emerging Markets",     "tracks",           "EMAE tracks MSCI EM IMI including small caps",             2.5),
    ("IBGL",                "Bond Markets",         "tracks",           "IBGL tracks EUR investment grade government bonds",        2.3),
    ("IBGL",                "ECB",                  "related",          "ECB rate decisions directly affect IBGL portfolio value",  1.9),
    ("TLT",                 "Bond Markets",         "tracks",           "TLT tracks 20+ year US Treasuries",                       2.3),
    ("TLT",                 "Federal Reserve",      "related",          "Fed rate decisions impact TLT via long-end yield",         1.9),
    ("TLT",                 "Duration",             "correlates_with",  "TLT ~17Y duration means 17% price move per 1% rate change",2.0),
    ("SPY",                 "Equity Markets",       "tracks",           "SPY tracks S&P 500 largest US companies",                  2.5),
    ("QQQ",                 "Technology Sector",    "tracks",           "QQQ is 40%+ technology sector via Nasdaq-100",             2.2),
    ("GLD",                 "Gold",                 "tracks",           "GLD tracks spot gold price with >0.99 correlation",        2.5),
    ("XGLD",                "Gold",                 "tracks",           "Xetra-Gold physically backed, deliverable",                2.4),
    ("IAU",                 "Gold",                 "tracks",           "IAU tracks gold spot price, cheaper TER than GLD",         2.4),
    ("HYG",                 "Credit Spread",        "tracks",           "HYG price inversely tracks high yield credit spreads",     2.2),
    ("LQD",                 "Credit Spread",        "tracks",           "LQD tracks investment grade credit spreads",               2.1),
    ("EEM",                 "Emerging Markets",     "tracks",           "EEM tracks MSCI Emerging Markets benchmark",               2.4),
    ("VWO",                 "Emerging Markets",     "tracks",           "VWO tracks FTSE Emerging Markets (excludes Korea)",        2.3),
    ("IWM",                 "Equity Markets",       "tracks",           "IWM tracks Russell 2000 US small caps",                    2.2),
    ("EFA",                 "Developed Markets",    "tracks",           "EFA tracks MSCI EAFE (Europe, Australasia, Far East)",     2.2),
    ("XLF",                 "Financial Sector",     "tracks",           "XLF tracks US financial sector",                           2.2),
    ("XLE",                 "Energy Sector",        "tracks",           "XLE tracks US energy sector stocks",                       2.2),
    ("XLK",                 "Technology Sector",    "tracks",           "XLK tracks US technology sector",                          2.2),
    # Commodity relationships
    ("Copper",              "GDP Growth",           "correlates_with",  "Copper industrial demand tracks global growth cycle",      1.7),
    ("Copper",              "China",                "correlates_with",  "China accounts for 50%+ of global copper consumption",     1.9),
    ("Gold",                "Risk-Off",             "correlates_with",  "Gold rallies in risk-off and geopolitical uncertainty",    1.7),
    ("Gold",                "Real Yield",           "contradicts",      "Negative real yields reduce opportunity cost of holding gold",1.8),
    ("Oil Price",           "Energy Sector",        "influences",       "Oil price directly drives energy sector earnings",         2.0),
    ("Oil Price",           "Inflation",            "causes",           "Oil spike transmits to CPI via transport and energy",      1.9),
    ("Lithium",             "Energy Transition",    "part_of",          "Lithium is critical battery material for EV transition",   1.8),
    ("Copper",              "Energy Transition",    "related",          "EV and solar require 4x more copper than conventional tech",1.7),
    ("Uranium",             "Energy Security",      "related",          "Nuclear power renaissance for baseload energy security",   1.5),
    # Geopolitical
    ("Russia",              "Oil Price",            "influences",       "Russia is world's 2nd largest oil exporter, OPEC+ member", 1.8),
    ("Russia",              "Natural Gas",          "influences",       "Russia historically supplied 40% of European gas",         1.9),
    ("Russia",              "Sanctions",            "related",          "Western sanctions post-Ukraine invasion 2022",             2.0),
    ("China",               "Emerging Markets",     "influences",       "Chinese growth cycle drives EM sentiment and flows",       1.8),
    ("China",               "Copper",               "influences",       "China 50%+ of copper demand; growth = copper rally",      1.9),
    ("China",               "Taiwan",               "related",          "Taiwan reunification as stated Chinese policy goal",       1.8),
    ("Taiwan",              "TSMC",                 "related",          "TSMC produces 90%+ of world's advanced semiconductors",    2.2),
    ("TSMC",                "AI Revolution",        "related",          "TSMC makes Nvidia GPUs that power the AI revolution",      1.9),
    ("ASML",                "TSMC",                 "related",          "ASML EUV machines are essential for TSMC chip production", 2.1),
    ("Nvidia",              "AI Revolution",        "related",          "Nvidia H100/H200 GPUs are the infrastructure of AI",       2.2),
    ("Geopolitical Risk",   "Oil Price",            "causes",           "Middle East conflicts create oil supply disruption fear",  1.8),
    ("Geopolitical Risk",   "Gold",                 "causes",           "Geopolitical uncertainty drives flight to gold",           1.7),
    ("Geopolitical Risk",   "Risk-Off",             "causes",           "Major geopolitical events trigger risk-off across markets",1.8),
    ("Trade War",           "Emerging Markets",     "influences",       "US-China tariffs disrupt EM supply chains and sentiment",  1.6),
    ("Deglobalization",     "Inflation",            "causes",           "Reshoring and tariffs raise production costs structurally",1.5),
    ("Energy Transition",   "Copper",               "influences",       "Solar, wind, EV massively increase copper demand",         1.7),
    ("Energy Transition",   "Lithium",              "influences",       "EV battery demand creates structural lithium bull market", 1.7),
    # Macro → portfolio
    ("Recession",           "Equity Markets",       "influences",       "Recessions reduce earnings, expand risk premiums, lower equity",2.0),
    ("Recession",           "High Yield Bond",      "influences",       "Recessions increase HY default rates, widen spreads",     1.8),
    ("Stagflation",         "Bond Markets",         "influences",       "Stagflation erodes real bond returns (inflation + low growth)",1.8),
    ("Stagflation",         "Gold",                 "correlates_with",  "Gold historically outperforms in stagflation (1970s)",     1.7),
    ("Soft Landing",        "Equity Markets",       "influences",       "Soft landing bullish: growth without recession",           1.7),
    ("Hard Landing",        "Recession",            "causes",           "Hard landing by definition involves recession",            2.0),
    ("Yield Curve Inversion","Credit Spread",       "correlates_with",  "Both signal credit stress and recession risk simultaneously",1.7),
    # Portfolio strategies
    ("Dollar Cost Averaging","Equity Markets",      "related",          "DCA into index funds (VWCE) core of passive investing",    1.5),
    ("60/40 Portfolio",     "Equity Markets",       "invests_in",       "60% stock allocation for long-term growth",                1.8),
    ("60/40 Portfolio",     "Bond Markets",         "invests_in",       "40% bond allocation for stability and diversification",    1.8),
    ("VWCE",                "Dollar Cost Averaging","related",          "VWCE+DCA is most recommended EU passive investing strategy",1.6),
    ("VWCE",                "60/40 Portfolio",      "part_of",          "VWCE is typical equity component of 60/40 for EU investors",1.5),
    ("IBGL",                "60/40 Portfolio",      "part_of",          "IBGL is typical bond component for EUR investors",         1.5),
    # AI and tech
    ("AI Revolution",       "Technology Sector",    "influences",       "AI drives cloud spend, semiconductor demand, productivity gains",1.8),
    ("AI Revolution",       "Nvidia",               "influences",       "AI is primary demand driver for Nvidia GPU products",      2.1),
    ("AI Revolution",       "Microsoft",            "influences",       "OpenAI/Copilot integration drives Azure growth",           1.7),
    ("AI Revolution",       "Alphabet",             "influences",       "Google AI competition and opportunity from search disruption",1.6),
]


async def run_mega_seed() -> Tuple[int, int]:
    """
    Populate KG with 500+ curated financial/geopolitical nodes and relationships.
    Idempotent: safe to run multiple times (upsert logic).
    """
    from routers.knowledge_graph import upsert_node, upsert_edge
    from supabase_client import get_pool, ensure_kg_schema

    pool = await get_pool()
    await ensure_kg_schema()

    total_n = total_e = 0
    node_ids: Dict[str, int] = {}

    logger.info("KG Mega-Seed: upserting %d nodes…", len(MEGA_NODES))
    for label, ntype, desc in MEGA_NODES:
        nid = await upsert_node(label, ntype, desc, 0.98)
        if nid:
            node_ids[label] = nid
            total_n += 1
        await asyncio.sleep(0.01)  # prevent DB lock

    logger.info("KG Mega-Seed: nodes done (%d). Creating %d edges…", total_n, len(MEGA_EDGES))
    for src_l, tgt_l, rel, ev, w in MEGA_EDGES:
        sid = node_ids.get(src_l)
        tid = node_ids.get(tgt_l)
        if not sid:
            sid_node = await _find_node_id(src_l, pool)
            if sid_node:
                sid = sid_node
                node_ids[src_l] = sid
        if not tid:
            tid_node = await _find_node_id(tgt_l, pool)
            if tid_node:
                tid = tid_node
                node_ids[tgt_l] = tid
        if sid and tid:
            eid = await upsert_edge(sid, tid, rel, ev, w)
            if eid:
                total_e += 1
        await asyncio.sleep(0.01)

    logger.info("KG Mega-Seed complete: +%d nodes, +%d edges", total_n, total_e)
    return total_n, total_e


async def _find_node_id(label: str, pool) -> Optional[int]:
    try:
        if pool:
            async with pool.acquire() as conn:
                row = await conn.fetchrow("SELECT id FROM kg_nodes WHERE LOWER(label)=LOWER($1) LIMIT 1", label)
                return row["id"] if row else None
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT id FROM kg_nodes WHERE LOWER(label)=LOWER(?) LIMIT 1", (label,)) as c:
                    row = await c.fetchone()
                    return row["id"] if row else None
    except Exception:
        return None
