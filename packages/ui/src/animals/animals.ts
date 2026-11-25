// Los 20 animales del código del apodo (2026-11-24, diseño en docs/mockups/animales/variantes.html), en el orden que
// eligió el usuario. Solo datos, sin `t()`: el servidor importa los ids por ruta relativa (node --test). Nombres y
// datos curiosos se traducen al mostrarlos (claves en i18n/en.ts). Fotos: Wikimedia Commons, por URL.

export type Animal = {
	id: string;
	name: string;
	/** Tres datos curiosos: rotan en la carta elegida. */
	facts: [string, string, string];
	img: string;
	/** `object-position` del recorte, si el centro no sirve. */
	pos?: string;
};

const W = (p: string) => `https://thumb.wikimedia.org/wikipedia/commons/thumb/${p}`;

export const ANIMALS: readonly Animal[] = [
	{ id: 'yaguarete', name: 'Yaguareté', facts: ['El felino más grande de América', 'Muerde hasta caparazones', 'Le encanta nadar'], img: W('e/e9/Jaguar_%28Panthera_onca_palustris%29_female_Piquiri_River_2.JPG/500px-Jaguar_%28Panthera_onca_palustris%29_female_Piquiri_River_2.JPG') },
	{ id: 'irbis', name: 'Leopardo de las nieves', facts: ['Se tapa la nariz con la cola', 'Salta hasta 15 m', 'No puede rugir'], img: W('a/a5/Irbis4.JPG/500px-Irbis4.JPG') },
	{ id: 'caracal', name: 'Caracal', facts: ['Caza pájaros al vuelo', 'Mechones negros en las orejas', 'Salta hasta 3 m'], img: W('e/e3/Caracal_Portrait_%287476164046%29.jpg/500px-Caracal_Portrait_%287476164046%29.jpg') },
	{ id: 'komodo', name: 'Dragón de Komodo', facts: ['El lagarto más grande: 3 m', 'Su mordida tiene veneno', 'Huele con la lengua'], img: W('5/51/Komodo_Dragon_%28Varanus_Komodoensis%29.jpg/500px-Komodo_Dragon_%28Varanus_Komodoensis%29.jpg') },
	{ id: 'yacare', name: 'Yacaré overo', facts: ['Le dicen "papada amarilla"', 'Vive en el Iberá', 'Hace su nido con hojas'], img: W('c/c3/Broad-snouted_caiman_zoo.jpg/500px-Broad-snouted_caiman_zoo.jpg') },
	{ id: 'lechucita', name: 'Lechucita', facts: ['Vive en cuevas', 'Caza de día', 'Imita el silbido de una víbora'], img: W('b/be/Southern_burrowing_owl_%28Athene_cunicularia_cunicularia%29_Colonia.jpg/500px-Southern_burrowing_owl_%28Athene_cunicularia_cunicularia%29_Colonia.jpg') },
	{ id: 'cardenal', name: 'Cardenal', facts: ['Es de acá: Pampa y Litoral', 'Copete rojo fuego', 'Lo ves en Costanera Sur'], img: W('e/e4/Red-crested_cardinal_%28Paroaria_coronata%29_Costanera_Sur.jpg/500px-Red-crested_cardinal_%28Paroaria_coronata%29_Costanera_Sur.jpg') },
	{ id: 'panda', name: 'Panda rojo', facts: ['Usa la cola de manta', 'Tiene un "falso pulgar"', 'Pariente lejano del mapache'], img: W('e/e6/Red_Panda_%2824986761703%29.jpg/500px-Red_Panda_%2824986761703%29.jpg') },
	{ id: 'comadreja', name: 'Comadreja overa', facts: ['Lleva a las crías en una bolsa', 'Es marsupial, como el canguro', 'Tiene 50 dientes'], img: W('1/16/Didelphis_albiventris-12-07-28.jpg/500px-Didelphis_albiventris-12-07-28.jpg'), pos: '15% 50%' },
	{ id: 'pichiciego', name: 'Pichiciego', facts: ['Armadillo rosado de 12 cm', '"Nada" bajo la arena', 'De Mendoza y San Luis'], img: W('2/21/Pink_Fairy_Armadillo_%28Chlamyphorus_truncatus%29.jpg/500px-Pink_Fairy_Armadillo_%28Chlamyphorus_truncatus%29.jpg') },
	{ id: 'aguara', name: 'Aguará guazú', facts: ['Un zorro en zancos', 'De Corrientes y el Chaco', 'Come mucha fruta'], img: W('0/0a/Chrysocyon_brachyurus_no_Parque_Nacional_da_Serra_da_Canastra_por_Celso_Ferrarezi_Jr_%2807%29.jpg/500px-Chrysocyon_brachyurus_no_Parque_Nacional_da_Serra_da_Canastra_por_Celso_Ferrarezi_Jr_%2807%29.jpg') },
	{ id: 'carpintero', name: 'Carpintero gigante', facts: ['Cabeza roja de punk', 'Se lo oye golpear de lejos', 'De los bosques del sur'], img: W('4/43/Magellanic_Woodpecker_Male_%28Campephilus_magellanicus%29.jpg/500px-Magellanic_Woodpecker_Male_%28Campephilus_magellanicus%29.jpg') },
	{ id: 'okapi', name: 'Okapi', facts: ['Pariente de la jirafa', 'Patas de cebra', 'Se limpia las orejas con la lengua'], img: W('3/3a/Saint-Aignan_%28Loir-et-Cher%29._Okapi.jpg/500px-Saint-Aignan_%28Loir-et-Cher%29._Okapi.jpg'), pos: '15% 50%' },
	{ id: 'pangolin', name: 'Pangolín', facts: ['Escamas como armadura', 'Se hace bolita', 'Lengua más larga que su cuerpo'], img: W('9/9d/Trenggiling_Sunda_Sunda_Pangolin_Manis_javanica.jpg/500px-Trenggiling_Sunda_Sunda_Pangolin_Manis_javanica.jpg'), pos: '35% 50%' },
	{ id: 'ajolote', name: 'Ajolote', facts: ['Le vuelven a crecer las patas', 'Siempre parece sonreír', 'Es de México'], img: W('6/60/AxolotlClif.jpg/500px-AxolotlClif.jpg') },
	{ id: 'nemo', name: 'Pez payaso', facts: ['Vive entre anémonas que pican', 'Lo protege una capa de moco', 'Todos nacen machos'], img: W('f/f6/Clown_fish_in_the_Andaman_Coral_Reef.jpg/500px-Clown_fish_in_the_Andaman_Coral_Reef.jpg') },
	{ id: 'condor', name: 'Cóndor andino', facts: ['Vuela sobre la cordillera', 'Alas de más de 3 m', 'Planea horas sin aletear'], img: W('b/bf/Flickr_-_law_keven_-_A_real_Condor_moment....jpg/500px-Flickr_-_law_keven_-_A_real_Condor_moment....jpg') },
	{ id: 'tucan', name: 'Tucán grande', facts: ['Vive en Misiones', 'Pico gigante pero liviano', 'Usa el pico para enfriarse'], img: W('f/fb/110_Toco_toucan_in_Encontro_das_%C3%81guas_State_Park_Photo_by_Giles_Laurent.jpg/500px-110_Toco_toucan_in_Encontro_das_%C3%81guas_State_Park_Photo_by_Giles_Laurent.jpg') },
	{ id: 'pinguino', name: 'Pingüino de Magallanes', facts: ['Anida en Punta Tombo', 'Rebuzna como un burro', 'Vuelve siempre a su pareja'], img: W('4/40/MagellanicPenguinAdult.jpg/500px-MagellanicPenguinAdult.jpg') },
	{ id: 'flamenco', name: 'Flamenco austral', facts: ['Vive en Mar Chiquita', 'Duerme en una pata', 'Es rosa por lo que come'], img: W('9/96/Close_up_of_Chilean_Flamingo_-_Phoenicopterus_chilensis_-_geograph.org.uk_-_6238012.jpg/500px-Close_up_of_Chilean_Flamingo_-_Phoenicopterus_chilensis_-_geograph.org.uk_-_6238012.jpg') }
];

/** Ids en el orden de la grilla del apodo nuevo. La posición es el número que guarda el servidor. */
export const ANIMAL_IDS: readonly string[] = ANIMALS.map((a) => a.id);
/** Cuántos animales tiene el código (en orden). */
export const CODE_LEN = 2;
/** Cartas de la ayuda del login: las primeras 4 filas (los 2 del código + 10 señuelos fijos por apodo). */
export const HELP_SIZE = 12;
/** Espera tras un código errado (la controla el servidor). */
export const WAIT_SECONDS = 15;
/** Lo que devuelve la app al mandar un código (crear o entrar). `wait`: segundos hasta poder probar de nuevo. */
export type CodeResult =
	| { ok: true; /** El apodo con el que quedó la sesión. */ nick?: string }
	| { ok: false; error: string; wait?: number; /** 409: el apodo cambió de estado; hay que volver a preguntar. */ changed?: boolean };

/** Más fallos que esto (sin acertar ni resetear) levantan una alerta en /admin. */
export const ALERT_FAILS = 3;
