# moroccan_cities.py
#
# This file is a simple dictionary of Moroccan cities with their
# latitude and longitude. No API needed — the coordinates are hardcoded.
#
# Used by:
#   - The backend to validate city names and store coordinates in the DB
#   - The /cities endpoint so the frontend can fetch this list
#
# To add a city later, just copy any line and fill in the correct coordinates.

MOROCCAN_CITIES: dict[str, dict] = {
    "Casablanca":   {"lat": 33.5731, "lng": -7.5898},
    "Rabat":        {"lat": 34.0209, "lng": -6.8416},
    "Marrakech":    {"lat": 31.6295, "lng": -7.9811},
    "Fès":          {"lat": 34.0181, "lng": -5.0078},
    "Tanger":       {"lat": 35.7595, "lng": -5.8340},
    "Tétouan":      {"lat": 35.5889, "lng": -5.3626},
    "Agadir":       {"lat": 30.4278, "lng": -9.5981},
    "Meknès":       {"lat": 33.8935, "lng": -5.5473},
    "Oujda":        {"lat": 34.6814, "lng": -1.9086},
    "Kénitra":      {"lat": 34.2610, "lng": -6.5802},
    "Nador":        {"lat": 35.1740, "lng": -2.9287},
    "Safi":         {"lat": 32.2994, "lng": -9.2372},
    "El Jadida":    {"lat": 33.2316, "lng": -8.5007},
    "Béni Mellal":  {"lat": 32.3369, "lng": -6.3498},
    "Khémisset":    {"lat": 33.8241, "lng": -6.0659},
    "Taza":         {"lat": 34.2100, "lng": -3.9959},
    "Settat":       {"lat": 33.0019, "lng": -7.6191},
    "Khouribga":    {"lat": 32.8812, "lng": -6.9063},
    "Berrechid":    {"lat": 33.2659, "lng": -7.5878},
    "Tiznit":       {"lat": 29.6974, "lng": -9.7316},
    "Dakhla":       {"lat": 23.7136, "lng": -15.9355},
    "Laâyoune":     {"lat": 27.1536, "lng": -13.2033},
    "Ouarzazate":   {"lat": 30.9335, "lng": -6.9370},
    "Errachidia":   {"lat": 31.9314, "lng": -4.4244},
    "Chefchaouen":  {"lat": 35.1688, "lng": -5.2636},
    "Al Hoceima":   {"lat": 35.2517, "lng": -3.9372},
    "Essaouira":    {"lat": 31.5085, "lng": -9.7595},
    "Ifrane":       {"lat": 33.5228, "lng": -5.1073},
    "Azrou":        {"lat": 33.4342, "lng": -5.2237},
    "Ouezzane":     {"lat": 34.7973, "lng": -5.5796},
}