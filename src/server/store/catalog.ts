import type { Category, Outlet, Theme } from "@/lib/api/types";

/** Médias et émetteurs connus (couleurs des monogrammes de la maquette). */
export const OUTLETS = {
  lesechos: {
    name: "Les Echos",
    domain: "lesechos.fr",
    brand: { initials: "E", bg: "#111111", fg: "#ffffff" },
  },
  figaro: {
    name: "Le Figaro",
    domain: "lefigaro.fr",
    brand: { initials: "F", bg: "#163d7a", fg: "#ffffff" },
  },
  bfm: {
    name: "BFM Business",
    domain: "bfmtv.com",
    brand: { initials: "BFM", bg: "#1453c6", fg: "#ffffff" },
  },
  ec: {
    name: "European Commission",
    domain: "ec.europa.eu",
    brand: { initials: "EC", bg: "#0e47cb", fg: "#ffd617" },
  },
  usine: {
    name: "Usine Nouvelle",
    domain: "usinenouvelle.com",
    brand: { initials: "UN", bg: "#e30613", fg: "#ffffff" },
  },
  dauphine: {
    name: "Le Dauphiné Libéré",
    domain: "ledauphine.com",
    brand: { initials: "DL", bg: "#c8102e", fg: "#ffffff" },
  },
  tribune: {
    name: "La Tribune",
    domain: "latribune.fr",
    brand: { initials: "LT", bg: "#0a2240", fg: "#ffffff" },
  },
  placegrenet: {
    name: "Place Gre'net",
    domain: "placegrenet.fr",
    brand: { initials: "PG", bg: "#e94e1b", fg: "#ffffff" },
  },
} satisfies Record<string, Outlet>;

export const LOCAL_OUTLETS: Outlet[] = [OUTLETS.dauphine, OUTLETS.placegrenet, OUTLETS.tribune];
export const NATIONAL_MEDIA: Outlet[] = [
  OUTLETS.lesechos,
  OUTLETS.figaro,
  OUTLETS.bfm,
  OUTLETS.usine,
];

export const NAME_PREFIXES = [
  "Belledonne",
  "Chartreuse",
  "Vercors",
  "Oisans",
  "Taillefer",
  "Chamrousse",
  "Moucherotte",
  "Néron",
  "Rachais",
  "Eynard",
  "Bastille",
  "Drac",
  "Romanche",
  "Grésivaudan",
  "Trièves",
  "Matheysine",
  "Écrins",
  "Obiou",
  "Lancey",
  "Allevard",
  "Uriage",
  "Sassenage",
  "Voreppe",
  "Vizille",
  "Arselle",
  "Chamechaude",
  "Granier",
  "Pinéa",
  "Casserousse",
  "Sept-Laux",
  "Prapoutel",
  "Bourne",
  "Furon",
  "Ferrière",
  "Lautaret",
  "Galibier",
  "Meije",
  "Muzelle",
  "Corbeyre",
  "Colombier",
  "Brévent",
  "Croix-de-Chamrousse",
  "Venosc",
  "Lauvitel",
  "Pravouta",
];

export interface SuffixSpec {
  s: string;
  sector: string;
  themes: Theme[];
  topic: string;
  products: string[];
}

export const NAME_SUFFIXES: SuffixSpec[] = [
  {
    s: "Photonics",
    sector: "Photonique",
    themes: ["deeptech_quantique", "ia_industrie"],
    topic: "photonique intégrée",
    products: ["de lasers compacts", "de capteurs optiques"],
  },
  {
    s: "Quantum",
    sector: "Technologies quantiques",
    themes: ["deeptech_quantique"],
    topic: "calcul quantique",
    products: ["de qubits supraconducteurs", "d'outils de simulation quantique"],
  },
  {
    s: "Robotics",
    sector: "Robotique industrielle",
    themes: ["ia_industrie"],
    topic: "robotique collaborative",
    products: ["de robots mobiles", "de cobots d'assemblage"],
  },
  {
    s: "Microsystems",
    sector: "Microélectronique",
    themes: ["deeptech_quantique", "ia_industrie"],
    topic: "microsystèmes",
    products: ["de MEMS industriels", "de puces basse consommation"],
  },
  {
    s: "Sensors",
    sector: "Capteurs",
    themes: ["ia_industrie"],
    topic: "capteurs intelligents",
    products: ["de capteurs connectés", "de capteurs de vibration"],
  },
  {
    s: "Semiconductors",
    sector: "Semi-conducteurs",
    themes: ["deeptech_quantique"],
    topic: "semi-conducteurs de puissance",
    products: ["de composants GaN", "de transistors de puissance"],
  },
  {
    s: "Nanotech",
    sector: "Nanotechnologies",
    themes: ["deeptech_quantique"],
    topic: "nanomatériaux",
    products: ["de revêtements nanostructurés", "de nanocapteurs"],
  },
  {
    s: "Materials",
    sector: "Matériaux avancés",
    themes: ["deeptech_quantique", "transition_energetique"],
    topic: "matériaux biosourcés",
    products: ["de composites recyclables", "de matériaux isolants"],
  },
  {
    s: "Hydrogen",
    sector: "Hydrogène",
    themes: ["transition_energetique"],
    topic: "hydrogène vert",
    products: ["d'électrolyseurs compacts", "de piles à combustible"],
  },
  {
    s: "Energy",
    sector: "Énergie",
    themes: ["transition_energetique"],
    topic: "pilotage énergétique",
    products: ["de solutions de stockage", "d'onduleurs intelligents"],
  },
  {
    s: "Batteries",
    sector: "Stockage d'énergie",
    themes: ["transition_energetique", "mobilite"],
    topic: "batteries bas carbone",
    products: ["de modules de batteries", "de systèmes de recyclage"],
  },
  {
    s: "Cleantech",
    sector: "Cleantech",
    themes: ["transition_energetique"],
    topic: "décarbonation industrielle",
    products: ["de solutions de captage", "de capteurs environnementaux"],
  },
  {
    s: "Thermal",
    sector: "Efficacité énergétique",
    themes: ["transition_energetique"],
    topic: "récupération de chaleur",
    products: ["de pompes à chaleur", "d'échangeurs thermiques"],
  },
  {
    s: "Water",
    sector: "Eau & environnement",
    themes: ["transition_energetique"],
    topic: "traitement de l'eau",
    products: ["de stations de filtration", "de capteurs de qualité de l'eau"],
  },
  {
    s: "Mobility",
    sector: "Mobilité",
    themes: ["mobilite", "transition_energetique"],
    topic: "mobilité électrique",
    products: ["de bornes de recharge", "de solutions de flotte"],
  },
  {
    s: "Drones",
    sector: "Drones",
    themes: ["ia_industrie", "mobilite"],
    topic: "inspection par drone",
    products: ["de drones d'inspection", "de logiciels de vol autonome"],
  },
  {
    s: "AI",
    sector: "Intelligence artificielle",
    themes: ["ia_industrie", "numerique"],
    topic: "intelligence artificielle industrielle",
    products: ["d'outils de vision par ordinateur", "d'assistants de maintenance"],
  },
  {
    s: "Analytics",
    sector: "Data & analytique",
    themes: ["numerique", "ia_industrie"],
    topic: "analyse de données",
    products: ["de tableaux de bord prédictifs", "d'outils d'analyse"],
  },
  {
    s: "Software",
    sector: "Logiciel",
    themes: ["numerique"],
    topic: "logiciels métiers",
    products: ["de logiciels SaaS", "d'outils collaboratifs"],
  },
  {
    s: "Cyber",
    sector: "Cybersécurité",
    themes: ["numerique"],
    topic: "cybersécurité industrielle",
    products: ["de sondes de détection", "de solutions de chiffrement"],
  },
  {
    s: "Biotech",
    sector: "Biotechnologies",
    themes: ["sante_biotech"],
    topic: "biotechnologies",
    products: ["de kits de bioproduction", "de thérapies cellulaires"],
  },
  {
    s: "Medical",
    sector: "Dispositifs médicaux",
    themes: ["sante_biotech"],
    topic: "dispositifs médicaux",
    products: ["de dispositifs de monitoring", "d'implants connectés"],
  },
  {
    s: "Diagnostics",
    sector: "Diagnostic",
    themes: ["sante_biotech"],
    topic: "diagnostic rapide",
    products: ["de tests de diagnostic", "d'analyseurs portables"],
  },
  {
    s: "Imaging",
    sector: "Imagerie",
    themes: ["sante_biotech", "deeptech_quantique"],
    topic: "imagerie médicale",
    products: ["d'imageurs compacts", "de logiciels d'imagerie"],
  },
  {
    s: "Talents",
    sector: "Ressources humaines",
    themes: ["talents_rh"],
    topic: "recrutement technique",
    products: ["de plateformes de recrutement", "d'outils d'onboarding"],
  },
  {
    s: "Skills",
    sector: "Formation",
    themes: ["talents_rh", "numerique"],
    topic: "formation professionnelle",
    products: ["de parcours de formation", "de simulateurs pédagogiques"],
  },
  {
    s: "Instruments",
    sector: "Instrumentation scientifique",
    themes: ["deeptech_quantique"],
    topic: "instrumentation scientifique",
    products: ["de cryostats", "d'instruments de mesure"],
  },
  {
    s: "Optics",
    sector: "Optique",
    themes: ["deeptech_quantique"],
    topic: "optique de précision",
    products: ["de lentilles adaptatives", "de systèmes optiques"],
  },
  {
    s: "Industries",
    sector: "Industrie du futur",
    themes: ["ia_industrie"],
    topic: "industrie 4.0",
    products: ["de lignes automatisées", "de jumeaux numériques"],
  },
  {
    s: "Labs",
    sector: "R&D",
    themes: ["deeptech_quantique", "ia_industrie"],
    topic: "recherche appliquée",
    products: ["de prototypes", "de bancs d'essai"],
  },
  {
    s: "Edge",
    sector: "Systèmes embarqués",
    themes: ["ia_industrie", "numerique"],
    topic: "systèmes embarqués",
    products: ["de calculateurs embarqués", "de passerelles IoT"],
  },
  {
    s: "People",
    sector: "Ressources humaines",
    themes: ["talents_rh"],
    topic: "gestion des talents",
    products: ["de solutions RH", "d'outils de mobilité interne"],
  },
];

export const TERRITORIES = [
  "Meylan (Inovallée)",
  "Montbonnot-Saint-Martin (Inovallée)",
  "Meylan (Inovallée)",
  "Montbonnot-Saint-Martin (Inovallée)",
  "Grenoble",
  "Crolles",
  "Saint-Égrève",
  "Échirolles",
  "Voiron",
];

export const BRAND_COLORS: { bg: string; fg: string }[] = [
  { bg: "#e2eefc", fg: "#1d5fae" },
  { bg: "#dcf7e6", fg: "#137a3a" },
  { bg: "#eee8fd", fg: "#5b37b8" },
  { bg: "#ffeedc", fg: "#b4530f" },
  { bg: "#ffe6ec", fg: "#b62a50" },
  { bg: "#e0f5f6", fg: "#0b6e7e" },
  { bg: "#1b2a4a", fg: "#ffffff" },
  { bg: "#0e8a9b", fg: "#ffffff" },
];

export const COUNTRIES = [
  "Allemagne",
  "Italie",
  "Espagne",
  "Suisse",
  "Belgique",
  "Pays-Bas",
  "Canada",
  "Japon",
  "Singapour",
  "États-Unis",
];
export const CITIES = [
  "Crolles",
  "Moirans",
  "Voreppe",
  "Pont-de-Claix",
  "Saint-Égrève",
  "Bernin",
  "Voiron",
];
export const PRIZES = [
  "Trophée de la deeptech alpine",
  "Prix régional de l'innovation industrielle",
  "Grand prix de la transition énergétique des Alpes",
  "Prix Inovallée de l'entrepreneuriat",
  "Concours des jeunes pousses alpines",
];

export const THEME_TAGS: Record<Theme, string> = {
  deeptech_quantique: "Deeptech",
  ia_industrie: "IA & industrie",
  transition_energetique: "Énergie",
  talents_rh: "Talents",
  sante_biotech: "Santé",
  mobilite: "Mobilité",
  numerique: "Numérique",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  financement: "Levée de fonds",
  acquisition: "Acquisition",
  contrat: "Contrat",
  partenariat: "Partenariat",
  innovation: "Innovation",
  produit: "Nouveau produit",
  brevet: "Brevet",
  recrutement: "Recrutement",
  croissance: "Croissance",
  international: "International",
  distinction: "Distinction & prix",
  recherche: "Recherche",
};

export interface EventText {
  title: string;
  summary: string;
  /** Extrait « communiqué » repris tel quel par les reprises (syndication). */
  communique: string;
  /** Extrait rédigé par un média indépendant. */
  media: string;
}

export interface EventParams {
  company: string;
  partner: string;
  amount: number;
  count: number;
  topic: string;
  product: string;
  country: string;
  city: string;
  prize: string;
}

/** Gabarits d'événements pour les entreprises fictives du jeu de démonstration. */
export const EVENT_TEMPLATES: Record<Category, (p: EventParams) => EventText> = {
  financement: (p) => ({
    title: `${p.company} lève ${p.amount} M€ pour accélérer son industrialisation`,
    summary: `${p.company} annonce une levée de fonds de ${p.amount} millions d'euros pour industrialiser sa technologie en ${p.topic} et renforcer ses équipes.`,
    communique: `${p.company} annonce une levée de fonds de ${p.amount} millions d'euros destinée à industrialiser sa technologie en ${p.topic}.`,
    media: `L'entreprise iséroise ${p.company} boucle un tour de table de ${p.amount} M€ pour passer à l'échelle industrielle.`,
  }),
  acquisition: (p) => ({
    title: `${p.company} rachète ${p.partner}`,
    summary: `${p.company} annonce l'acquisition de ${p.partner} afin d'élargir son offre en ${p.topic}.`,
    communique: `${p.company} annonce l'acquisition de ${p.partner}, renforçant ses compétences en ${p.topic}.`,
    media: `Opération de croissance externe pour ${p.company}, qui reprend ${p.partner} pour compléter son offre.`,
  }),
  contrat: (p) => ({
    title: `${p.company} remporte un contrat pluriannuel de ${p.amount} M€`,
    summary: `${p.company} remporte un contrat pluriannuel de ${p.amount} millions d'euros auprès d'un industriel européen.`,
    communique: `${p.company} remporte un contrat pluriannuel de ${p.amount} millions d'euros portant sur ${p.product}.`,
    media: `${p.company} décroche une commande pluriannuelle de ${p.amount} M€ auprès d'un industriel européen.`,
  }),
  partenariat: (p) => ({
    title: `${p.company} et ${p.partner} s'associent en ${p.topic}`,
    summary: `${p.company} et ${p.partner} annoncent un partenariat pour développer une offre commune en ${p.topic}.`,
    communique: `${p.company} et ${p.partner} annoncent un partenariat stratégique pour développer une offre commune en ${p.topic}.`,
    media: `Rapprochement entre ${p.company} et ${p.partner}, qui unissent leurs savoir-faire en ${p.topic}.`,
  }),
  innovation: (p) => ({
    title: `${p.company} dévoile une technologie inédite en ${p.topic}`,
    summary: `${p.company} présente une nouvelle technologie en ${p.topic} issue de trois années de développement.`,
    communique: `${p.company} présente une nouvelle technologie en ${p.topic}, fruit de trois années de développement.`,
    media: `${p.company} lève le voile sur une technologie de ${p.topic} développée dans ses laboratoires isérois.`,
  }),
  produit: (p) => ({
    title: `${p.company} lance sa nouvelle gamme ${p.product}`,
    summary: `${p.company} lance une nouvelle gamme ${p.product} destinée aux industriels.`,
    communique: `${p.company} annonce le lancement d'une nouvelle gamme ${p.product} destinée aux industriels.`,
    media: `Nouvelle offre pour ${p.company}, qui commercialise une gamme ${p.product}.`,
  }),
  brevet: (p) => ({
    title: `${p.company} obtient un brevet européen en ${p.topic}`,
    summary: `${p.company} obtient un brevet européen protégeant sa technologie en ${p.topic}.`,
    communique: `${p.company} annonce l'obtention d'un brevet européen protégeant sa technologie en ${p.topic}.`,
    media: `${p.company} sécurise sa propriété intellectuelle avec un brevet européen en ${p.topic}.`,
  }),
  recrutement: (p) => ({
    title: `${p.company} prévoit ${p.count} recrutements d'ici un an`,
    summary: `${p.company} annonce ${p.count} recrutements sur son site isérois au cours des douze prochains mois.`,
    communique: `${p.company} annonce ${p.count} recrutements sur son site isérois au cours des douze prochains mois.`,
    media: `${p.company} embauche : ${p.count} postes à pourvoir dans les douze prochains mois.`,
  }),
  croissance: (p) => ({
    title: `${p.company} inaugure un nouveau site de production à ${p.city}`,
    summary: `${p.company} inaugure un nouveau site de production à ${p.city} pour accompagner sa croissance.`,
    communique: `${p.company} inaugure son nouveau site de production à ${p.city} pour accompagner sa croissance.`,
    media: `${p.company} s'agrandit avec un nouveau site de production à ${p.city}.`,
  }),
  international: (p) => ({
    title: `${p.company} ouvre une filiale en ${p.country}`,
    summary: `${p.company} ouvre une filiale en ${p.country} pour accompagner son développement international.`,
    communique: `${p.company} annonce l'ouverture d'une filiale en ${p.country} pour accompagner son développement international.`,
    media: `${p.company} s'implante en ${p.country}, une étape clé de son développement international.`,
  }),
  distinction: (p) => ({
    title: `${p.company} lauréate du ${p.prize}`,
    summary: `${p.company} est distinguée par le ${p.prize} pour ses travaux en ${p.topic}.`,
    communique: `${p.company} est lauréate du ${p.prize} pour ses travaux en ${p.topic}.`,
    media: `Le ${p.prize} récompense ${p.company} pour ses travaux en ${p.topic}.`,
  }),
  recherche: (p) => ({
    title: `${p.company} publie des résultats de recherche en ${p.topic}`,
    summary: `${p.company} publie des résultats de recherche en ${p.topic} obtenus avec un laboratoire grenoblois.`,
    communique: `${p.company} publie des résultats de recherche en ${p.topic} obtenus avec un laboratoire grenoblois.`,
    media: `Des résultats scientifiques en ${p.topic} pour ${p.company} et son laboratoire partenaire.`,
  }),
};

export const ANGLE_TEMPLATES: Record<Category, { text: (c: string) => string; tags: string[] }> = {
  financement: {
    text: (c) => `${c} : une nouvelle étape de croissance financée depuis l'Isère`,
    tags: ["Financement", "Rayonnement territorial"],
  },
  acquisition: {
    text: (c) => `${c} accélère par croissance externe`,
    tags: ["Stratégie", "Croissance"],
  },
  contrat: { text: (c) => `${c} décroche un contrat structurant`, tags: ["Business", "Industrie"] },
  partenariat: {
    text: (c) => `${c} : un partenariat qui renforce l'écosystème`,
    tags: ["Partenariat", "Écosystème"],
  },
  innovation: {
    text: (c) => `${c} : l'innovation made in Inovallée`,
    tags: ["Innovation", "Technologie"],
  },
  produit: { text: (c) => `${c} élargit son offre`, tags: ["Produit", "Innovation"] },
  brevet: {
    text: (c) => `${c} protège son avance technologique`,
    tags: ["Propriété intellectuelle", "Innovation"],
  },
  recrutement: {
    text: (c) => `${c} recrute : des opportunités pour les talents du territoire`,
    tags: ["Emploi", "Talents"],
  },
  croissance: { text: (c) => `${c} change d'échelle`, tags: ["Croissance", "Industrie"] },
  international: {
    text: (c) => `${c} : l'innovation grenobloise à l'international`,
    tags: ["International", "Rayonnement territorial"],
  },
  distinction: {
    text: (c) => `${c} : une reconnaissance pour l'écosystème Inovallée`,
    tags: ["Distinction", "Rayonnement territorial"],
  },
  recherche: {
    text: (c) => `${c} : quand la recherche irrigue l'industrie`,
    tags: ["Recherche", "Innovation"],
  },
};
