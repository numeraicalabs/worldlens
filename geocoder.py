"""Country code → coordinates + name"""

COUNTRIES = {
    "AF": (-1, "Afghanistan", 33.93, 67.71),
    "AL": (-1, "Albania", 41.15, 20.17),
    "DZ": (-1, "Algeria", 28.03, 1.66),
    "AO": (-1, "Angola", -11.2, 17.87),
    "AR": (-1, "Argentina", -38.42, -63.62),
    "AM": (-1, "Armenia", 40.07, 45.04),
    "AU": (-1, "Australia", -25.27, 133.78),
    "AT": (-1, "Austria", 47.52, 14.55),
    "AZ": (-1, "Azerbaijan", 40.14, 47.58),
    "BD": (-1, "Bangladesh", 23.68, 90.36),
    "BY": (-1, "Belarus", 53.71, 27.95),
    "BE": (-1, "Belgium", 50.5, 4.47),
    "BO": (-1, "Bolivia", -16.29, -63.59),
    "BA": (-1, "Bosnia", 43.92, 17.68),
    "BR": (-1, "Brazil", -14.24, -51.93),
    "BG": (-1, "Bulgaria", 42.73, 25.49),
    "KH": (-1, "Cambodia", 12.57, 104.99),
    "CM": (-1, "Cameroon", 3.85, 11.5),
    "CA": (-1, "Canada", 56.13, -106.35),
    "CF": (-1, "Central African Republic", 6.61, 20.94),
    "TD": (-1, "Chad", 15.45, 18.73),
    "CL": (-1, "Chile", -35.68, -71.54),
    "CN": (-1, "China", 35.86, 104.2),
    "CO": (-1, "Colombia", 4.57, -74.3),
    "CD": (-1, "DR Congo", -4.04, 21.76),
    "CG": (-1, "Congo", -0.23, 15.83),
    "HR": (-1, "Croatia", 45.1, 15.2),
    "CU": (-1, "Cuba", 21.52, -77.78),
    "CZ": (-1, "Czech Republic", 49.82, 15.47),
    "DK": (-1, "Denmark", 56.26, 9.5),
    "EG": (-1, "Egypt", 26.82, 30.8),
    "ET": (-1, "Ethiopia", 9.15, 40.49),
    "FI": (-1, "Finland", 61.92, 25.75),
    "FR": (-1, "France", 46.23, 2.21),
    "DE": (-1, "Germany", 51.17, 10.45),
    "GH": (-1, "Ghana", 7.95, -1.02),
    "GR": (-1, "Greece", 39.07, 21.82),
    "GT": (-1, "Guatemala", 15.78, -90.23),
    "HT": (-1, "Haiti", 18.97, -72.29),
    "HN": (-1, "Honduras", 15.2, -86.24),
    "HU": (-1, "Hungary", 47.16, 19.5),
    "IN": (-1, "India", 20.59, 78.96),
    "ID": (-1, "Indonesia", -0.79, 113.92),
    "IR": (-1, "Iran", 32.43, 53.69),
    "IQ": (-1, "Iraq", 33.22, 43.68),
    "IE": (-1, "Ireland", 53.41, -8.24),
    "IL": (-1, "Israel", 31.05, 34.85),
    "IT": (-1, "Italy", 41.87, 12.57),
    "JP": (-1, "Japan", 36.2, 138.25),
    "JO": (-1, "Jordan", 30.59, 36.24),
    "KZ": (-1, "Kazakhstan", 48.02, 66.92),
    "KE": (-1, "Kenya", -0.02, 37.91),
    "KP": (-1, "North Korea", 40.34, 127.51),
    "KR": (-1, "South Korea", 35.91, 127.77),
    "KW": (-1, "Kuwait", 29.31, 47.48),
    "LB": (-1, "Lebanon", 33.85, 35.86),
    "LY": (-1, "Libya", 26.34, 17.23),
    "MY": (-1, "Malaysia", 4.21, 101.98),
    "MX": (-1, "Mexico", 23.63, -102.55),
    "MA": (-1, "Morocco", 31.79, -7.09),
    "MZ": (-1, "Mozambique", -18.67, 35.53),
    "MM": (-1, "Myanmar", 16.87, 96.08),
    "NP": (-1, "Nepal", 28.39, 84.12),
    "NL": (-1, "Netherlands", 52.13, 5.29),
    "NZ": (-1, "New Zealand", -40.9, 174.89),
    "NG": (-1, "Nigeria", 9.08, 8.68),
    "NO": (-1, "Norway", 60.47, 8.47),
    "PK": (-1, "Pakistan", 30.38, 69.35),
    "PA": (-1, "Panama", 8.54, -80.78),
    "PY": (-1, "Paraguay", -23.44, -58.44),
    "PE": (-1, "Peru", -9.19, -75.02),
    "PH": (-1, "Philippines", 12.88, 121.77),
    "PL": (-1, "Poland", 51.92, 19.15),
    "PT": (-1, "Portugal", 39.4, -8.22),
    "QA": (-1, "Qatar", 25.35, 51.18),
    "RO": (-1, "Romania", 45.94, 24.97),
    "RU": (-1, "Russia", 61.52, 105.32),
    "SA": (-1, "Saudi Arabia", 23.89, 45.08),
    "SN": (-1, "Senegal", 14.5, -14.45),
    "RS": (-1, "Serbia", 44.02, 21.01),
    "SO": (-1, "Somalia", 5.15, 46.2),
    "ZA": (-1, "South Africa", -30.56, 22.94),
    "SS": (-1, "South Sudan", 6.88, 31.57),
    "ES": (-1, "Spain", 40.46, -3.75),
    "LK": (-1, "Sri Lanka", 7.87, 80.77),
    "SD": (-1, "Sudan", 12.86, 30.22),
    "SE": (-1, "Sweden", 60.13, 18.64),
    "CH": (-1, "Switzerland", 46.82, 8.23),
    "SY": (-1, "Syria", 34.8, 38.99),
    "TW": (-1, "Taiwan", 23.7, 121.0),
    "TJ": (-1, "Tajikistan", 38.86, 71.28),
    "TZ": (-1, "Tanzania", -6.37, 34.89),
    "TH": (-1, "Thailand", 15.87, 100.99),
    "TN": (-1, "Tunisia", 33.89, 9.54),
    "TR": (-1, "Turkey", 38.96, 35.24),
    "UA": (-1, "Ukraine", 48.38, 31.17),
    "AE": (-1, "UAE", 23.42, 53.85),
    "GB": (-1, "United Kingdom", 55.38, -3.44),
    "US": (-1, "United States", 37.09, -95.71),
    "UZ": (-1, "Uzbekistan", 41.38, 64.59),
    "VE": (-1, "Venezuela", 6.42, -66.59),
    "VN": (-1, "Vietnam", 14.06, 108.28),
    "YE": (-1, "Yemen", 15.55, 48.52),
    "ZM": (-1, "Zambia", -13.13, 27.85),
    "ZW": (-1, "Zimbabwe", -19.02, 29.15),
    "PS": (-1, "Palestine", 31.95, 35.23),
    "ML": (-1, "Mali", 17.57, -3.99),
    "NE": (-1, "Niger", 17.61, 8.08),
    "BF": (-1, "Burkina Faso", 12.36, -1.56),
}

COUNTRY_NAMES = {v[1].lower(): k for k, v in COUNTRIES.items()}


def get_coords(code: str) -> tuple:
    data = COUNTRIES.get(code.upper())
    if data:
        return data[2], data[3]
    return 0.0, 0.0


def get_name(code: str) -> str:
    data = COUNTRIES.get(code.upper())
    return data[1] if data else code


def find_country(text: str) -> str:
    """Find best matching country code from text."""
    text_lower = text.lower()
    KEYWORD_MAP = {
        "ukraine": "UA", "russia": "RU", "israel": "IL", "gaza": "PS",
        "palestine": "PS", "iran": "IR", "china": "CN", "taiwan": "TW",
        "north korea": "KP", "syria": "SY", "sudan": "SD", "myanmar": "MM",
        "afghanistan": "AF", "iraq": "IQ", "yemen": "YE", "somalia": "SO",
        "ethiopia": "ET", "haiti": "HT", "venezuela": "VE", "pakistan": "PK",
        "india": "IN", "turkey": "TR", "saudi arabia": "SA", "nigeria": "NG",
        "france": "FR", "germany": "DE", "united kingdom": "GB", "britain": "GB",
        "united states": "US", "america": "US", "japan": "JP", "brazil": "BR",
        "mexico": "MX", "colombia": "CO", "indonesia": "ID", "south korea": "KR",
        "poland": "PL", "hungary": "HU", "serbia": "RS", "mali": "ML",
        "niger": "NE", "burkina faso": "BF", "congo": "CD", "libya": "LY",
        "lebanon": "LB", "egypt": "EG", "morocco": "MA", "algeria": "DZ",
        "south africa": "ZA", "kenya": "KE", "thailand": "TH",
        "philippines": "PH", "vietnam": "VN", "malaysia": "MY",
    }
    for kw, code in KEYWORD_MAP.items():
        if kw in text_lower:
            return code
    for name_lower, code in COUNTRY_NAMES.items():
        if name_lower in text_lower:
            return code
    return "XX"
