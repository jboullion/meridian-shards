// Resource languages (module/merintr/language.c): the .rsb holds each string in one or more
// languages, by number. The Language menu lists those the .rsb has, by these names
// (language_id_table, in id order), and a string missing in the chosen language falls back
// to English (clientd3d/loadrsc.c LookupRsc).

/** language_id_table's names, indexed by language id */
export const LANGUAGE_NAMES: readonly string[] = [
  "English", "German", "Korean", "Russian", "Swedish", "Abkhazian", "Afar", "Afrikaans", "Akan", "Albanian",
  "Amharic", "Arabic", "Aragonese", "Armenian", "Assamese", "Avaric", "Avestan", "Aymara", "Azerbaijani",
  "Bambara", "Bashkir", "Basque", "Belarusian", "Bengali", "Bihari", "Bislama", "Bokmål", "Bosnian",
  "Breton", "Bulgarian", "Burmese", "Catalan", "Chamorro", "Chechen", "Chinese", "Chuvash", "Cornish",
  "Corse", "Cree", "Croatian", "Czech", "Danish", "Divehi", "Dutch", "Dzongkha", "Esperanto", "Estonian",
  "Ewe", "Faroese", "Fijian", "Finnish", "Français", "Frisian", "Fulah", "Gaelic", "Gallegan", "Ganda",
  "Georgian", "Greek", "Greenlandic", "Guarani", "Gujarati", "Hausa", "Hebrew", "Herero", "Hindi",
  "Hiri Motu", "Hungarian", "Icelandic", "Ido", "Igbo", "Indonesian", "Interlingua", "Interlingue",
  "Inuktitut", "Inupiaq", "Irish", "Italian", "Japanese", "Javanese", "Kannada", "Kanuri", "Kashmiri",
  "Kazakh", "Khmer", "Kikuyu", "Kinyarwanda", "Kirghiz", "Komi", "Kongo", "Kuanyama", "Kurdish", "Lao",
  "Latin", "Latvian", "Letzeburgesch", "Limburgan", "Lingala", "Lithuanian", "Luba-Katanga", "Macedonian",
  "Malagasy", "Malay", "Malayalam", "Maltese", "Manx", "Maori", "Marathi", "Marshallese", "Moldavian",
  "Mongolian", "Nauru", "Navaho", "Ndebele North", "Ndebele South", "Ndonga", "Nepali", "Northern Sami",
  "Norwegian", "Nynorsk", "Nyanja", "Provençal", "Ojibwa", "Old Bulgarian", "Oriya", "Oromo", "Ossetian",
  "Pali", "Panjabi", "Persian", "Polish", "Portuguese", "Pushto", "Quechua", "Raeto-Romance", "Romanian",
  "Rundi", "Samoan", "Sango", "Sanskrit", "Sardinian", "Serbian", "Shona", "Sichuan Yi", "Sindhi",
  "Sinhalese", "Slovak", "Slovenian", "Somali", "Sotho", "Spanish", "Sundanese", "Swahili", "Swati",
  "Tagalog", "Tahitian", "Tajik", "Tamil", "Tatar", "Telugu", "Thai", "Tibetan", "Tigrinya", "Tonga",
  "Tsonga", "Tswana", "Turkish", "Turkmen", "Twi", "Uighur", "Ukrainian", "Urdu", "Uzbek", "Venda",
  "Vietnamese", "Volapük", "Walloon", "Welsh", "Wolof", "Xhosa", "Yiddish", "Yoruba", "Zhuang", "Zulu",
];

export const languageName = (id: number): string => LANGUAGE_NAMES[id] ?? `Language ${id}`;
