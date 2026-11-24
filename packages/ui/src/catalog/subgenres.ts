// Géneros y subgéneros del catálogo (2026-11-23): las "interests" de IMDb (ids `in…`), que IMDb agrupa por género.
// Se elige un género por vez; dentro, "Todos" o algunos subgéneros. Con un género elegido, el catálogo sale de la búsqueda
// de IMDb (web: `web/src/lib/server/interests.ts`; desktop: `crates/core/src/catalog/interests.rs`). Los nombres y
// explicaciones son nuestros; los ids, los de IMDb. Dibujo y color de cada género: `genre-art.ts` (por id de TMDB).
import { t } from '../i18n/runtime.ts';
import type { Kind } from '../types.ts';

/** `withGenre`: el nombre es un adjetivo del género ("Psicológico"); fuera del picker va con él ("Terror psicológico"). */
export type Subgenre = { id: string; label: string; desc: string; withGenre?: boolean };
export type Category = {
	key: string;
	label: string;
	/** "Todos": las interests que cubren el género entero. */
	all: string[];
	/** Id de TMDB del género con el mismo dibujo (`genreArt`). */
	art: string;
	subs: Subgenre[];
	/** Solo tiene sentido en ese tipo (reality: series). */
	only?: Kind;
};

const s = (id: string, label: string, desc: string, withGenre = false): Subgenre => ({ id, label, desc, withGenre });

/** En el idioma de la app (se arma en cada llamada para que cambie con el idioma). */
export const categories = (): Category[] => [
	{ key: 'action', label: t('Acción'), all: ['in0000001'], art: '28', subs: [
		s('in0000008', t('Superhéroes'), t('Poderes, capas y el mundo en peligro')),
		s('in0000010', t('Bélica'), t('Soldados, frentes y batallas'), true),
		s('in0000006', t('Artes marciales'), t('Peleas cuerpo a cuerpo coreografiadas')),
		s('in0000004', t('Autos'), t('Persecuciones y carreras a fondo')),
		s('in0000005', t('Catástrofes'), t('Terremotos, tsunamis y meteoritos')),
		s('in0000007', t('Uno contra todos'), t('Un solo héroe contra un ejército')),
		s('in0000002', t('Épica'), t('Grandes batallas a escala enorme'), true),
		s('in0000199', t('Samuráis'), t('Espadas, honor y el Japón feudal'))
	] },
	{ key: 'adventure', label: t('Aventura'), all: ['in0000012'], art: '12', subs: [
		s('in0000019', t('Búsquedas'), t('Un objetivo y un largo camino')),
		s('in0000016', t('Por el mundo'), t('Viajes entre países y continentes'), true),
		s('in0000021', t('En el mar'), t('Barcos, islas y tormentas'), true),
		s('in0000017', t('En la selva'), t('Calor, ruinas y peligros'), true),
		s('in0000014', t('Dinosaurios'), t('Bestias prehistóricas sueltas')),
		s('in0000020', t('Road trip'), t('En la ruta, de punta a punta')),
		s('in0000022', t('Capa y espada'), t('Piratas, duelos y mosqueteros')),
		s('in0000023', t('Adolescente'), t('Chicos que salen a la aventura'), true)
	] },
	{ key: 'animation', label: t('Animación'), all: ['in0000026'], art: '16', subs: [
		s('in0000025', t('Para adultos'), t('Animadas, pero no para chicos'), true),
		s('in0000028', t('Por computadora'), t('El 3D de Pixar y compañía'), true),
		s('in0000029', t('Dibujada a mano'), t('Cuadro por cuadro, como antes'), true),
		s('in0000030', t('Stop motion'), t('Muñecos movidos foto a foto'), true)
	] },
	{ key: 'comedy', label: t('Comedia'), all: ['in0000034'], art: '35', subs: [
		s('in0000035', t('Negra'), t('Risas con temas oscuros'), true),
		s('in0000044', t('Sitcom'), t('Episodios cortos con risas')),
		s('in0000042', t('Sátira'), t('Se ríe del poder y de la sociedad')),
		s('in0000039', t('Parodia'), t('Imita y exagera otras películas')),
		s('in0000032', t('De amigos'), t('Dos que no se parecen en nada'), true),
		s('in0000041', t('Zarpada'), t('Humor sin filtro, para adultos'), true),
		s('in0000038', t('Falso documental'), t('Filmada como si fuera real')),
		s('in0000046', t('Slapstick'), t('Golpes, caídas y humor físico')),
		s('in0000049', t('Adolescente'), t('Colegio, fiestas y primeras veces'), true),
		s('in0000047', t('Stand-up'), t('Un comediante y un micrófono'))
	] },
	{ key: 'crime', label: t('Crimen'), all: ['in0000052'], art: '80', subs: [
		s('in0000055', t('Mafia'), t('Familias, códigos y traiciones')),
		s('in0000056', t('Atracos'), t('El gran golpe, planeado al detalle')),
		s('in0000058', t('Hechos reales'), t('Casos que pasaron de verdad')),
		s('in0000057', t('Policial'), t('Una investigación paso a paso')),
		s('in0000053', t('Narcos'), t('Drogas, carteles y dinero')),
		s('in0000054', t('Cine negro'), t('Detectives, sombras y femmes fatales')),
		s('in0000050', t('Golpe con humor'), t('Robos livianos y con estilo'))
	] },
	{ key: 'documentary', label: t('Documental'), all: ['in0000060'], art: '99', subs: [
		s('in0000059', t('Crímenes'), t('Casos reales, de principio a fin')),
		s('in0000066', t('Música'), t('Bandas, giras y artistas')),
		s('in0000064', t('Historia'), t('El pasado, contado con archivo')),
		s('in0000067', t('Naturaleza'), t('Animales, planeta y paisajes')),
		s('in0000069', t('Ciencia y tecnología'), t('Inventos, espacio y descubrimientos')),
		s('in0000070', t('Deportes'), t('Atletas, equipos y hazañas')),
		s('in0000068', t('Política'), t('Poder, elecciones y escándalos')),
		s('in0000063', t('Comida'), t('Cocina, chefs y sabores'))
	] },
	{ key: 'drama', label: t('Drama'), all: ['in0000076'], art: '18', subs: [
		s('in0000086', t('Psicológico'), t('La cabeza del personaje, por dentro'), true),
		s('in0000073', t('Crecer'), t('Dejar de ser chico')),
		s('in0000072', t('Biografías'), t('La vida de alguien real')),
		s('in0000083', t('De época'), t('Otros siglos, otras costumbres'), true),
		s('in0000081', t('Judicial'), t('Juicios, abogados y veredictos'), true),
		s('in0000082', t('Médico'), t('Hospitales, guardias y diagnósticos'), true),
		s('in0000084', t('Político'), t('Poder y decisiones de Estado'), true),
		s('in0000090', t('Tragedia'), t('Historias que terminan mal')),
		s('in0000085', t('Cárcel'), t('La vida tras las rejas'))
	] },
	{ key: 'family', label: t('Familia'), all: ['in0000093'], art: '10751', subs: [
		s('in0000092', t('Con animales'), t('Aventuras con mascotas y bichos'), true)
	] },
	{ key: 'fantasy', label: t('Fantasía'), all: ['in0000098'], art: '14', subs: [
		s('in0000095', t('Oscura'), t('Magia con monstruos y sombras'), true),
		s('in0000096', t('Épica'), t('Reinos, profecías y grandes viajes'), true),
		s('in0000099', t('Sobrenatural'), t('Lo mágico en el mundo de hoy'), true),
		s('in0000100', t('Espada y brujería'), t('Guerreros, hechizos y dragones')),
		s('in0000097', t('Cuentos de hadas'), t('Princesas, brujas y finales felices')),
		s('in0000101', t('Adolescente'), t('Jóvenes con poderes'), true)
	] },
	{ key: 'horror', label: t('Terror'), all: ['in0000112'], art: '27', subs: [
		s('in0000114', t('Psicológico'), t('El miedo está en la cabeza del personaje'), true),
		s('in0000117', t('Sobrenatural'), t('Fantasmas, demonios y posesiones'), true),
		s('in0000109', t('Del cuerpo'), t('Cuerpos que cambian, se rompen o mutan'), true),
		s('in0000110', t('Folk'), t('Pueblos aislados, rituales y tradiciones viejas'), true),
		s('in0000115', t('Slasher'), t('Un asesino, un cuchillo y una lista de víctimas')),
		s('in0000113', t('Monstruos'), t('Criaturas gigantes o que acechan')),
		s('in0000122', t('Zombis'), t('Muertos que caminan y el fin del mundo')),
		s('in0000111', t('Metraje encontrado'), t('Filmado como si fuera real, con cámara en mano')),
		s('in0000119', t('Vampiros'), t('Colmillos, sangre y la noche')),
		s('in0000121', t('Brujas'), t('Hechizos, aquelarres y maldiciones'))
	] },
	{ key: 'music', label: t('Música'), all: ['in0000130', 'in0000133'], art: '10402', subs: [
		s('in0000133', t('Musicales'), t('Cuentan la historia cantando')),
		s('in0000132', t('Con canciones conocidas'), t('Éxitos de siempre metidos en la trama'), true),
		s('in0000129', t('Recitales'), t('El show en vivo, entero'))
	] },
	{ key: 'mystery', label: t('Misterio'), all: ['in0000139'], art: '9648', subs: [
		s('in0000141', t('¿Quién lo hizo?'), t('Hasta el final no se sabe')),
		s('in0000140', t('Con suspenso'), t('Pistas que tensan cada escena'), true),
		s('in0000137', t('Misterio liviano'), t('Pueblo chico, un crimen y té')),
		s('in0000138', t('Detective duro'), t('Calles sucias y un investigador cínico')),
		s('in0000136', t('Detective torpe'), t('Resuelve casos de casualidad'))
	] },
	{ key: 'romance', label: t('Romance'), all: ['in0000152'], art: '10749', subs: [
		s('in0000153', t('Comedia romántica'), t('Enamorarse, con risas')),
		s('in0000151', t('Para sentirse bien'), t('Amores que te dejan contento'), true),
		s('in0000156', t('Trágico'), t('Amores que duelen'), true),
		s('in0000154', t('Subido de tono'), t('Romance con mucha piel'), true),
		s('in0000149', t('Oscuro'), t('Pasión, obsesión y peligro'), true),
		s('in0000155', t('Adolescente'), t('Primeros amores'), true),
		s('in0000150', t('Épico'), t('Amor en medio de la historia'), true)
	] },
	{ key: 'scifi', label: t('Ciencia ficción'), all: ['in0000162'], art: '878', subs: [
		s('in0000164', t('Espacio'), t('Naves, planetas y viajes estelares')),
		s('in0000160', t('Distopía'), t('Futuros que salieron mal')),
		s('in0000166', t('Viajes en el tiempo'), t('Ir y volver, con consecuencias')),
		s('in0000158', t('Inteligencia artificial'), t('Máquinas que piensan')),
		s('in0000157', t('Invasión alienígena'), t('Llegaron, y no en son de paz')),
		s('in0000159', t('Cyberpunk'), t('Neón, hackers y megaempresas')),
		s('in0000161', t('Kaiju'), t('Monstruos gigantes contra ciudades')),
		s('in0000163', t('Épica'), t('Universos enteros en juego'), true)
	] },
	{ key: 'sport', label: t('Deportes'), all: ['in0000174'], art: 'sport', subs: [
		s('in0000169', t('Boxeo'), t('Guantes, ring y revancha')),
		s('in0000173', t('Fútbol'), t('La pelota, la cancha y la hinchada')),
		s('in0000171', t('Fútbol americano'), t('Cascos, tackles y touchdowns')),
		s('in0000168', t('Básquet'), t('Aros, triples y finales')),
		s('in0000172', t('Automovilismo'), t('Fórmula 1, rally y velocidad')),
		s('in0000167', t('Béisbol'), t('Bates, guantes y jonrones'))
	] },
	{ key: 'thriller', label: t('Suspenso'), all: ['in0000186'], art: '53', subs: [
		s('in0000182', t('Psicológico'), t('Mentes retorcidas y giros'), true),
		s('in0000184', t('Espías'), t('Agentes, misiones y traiciones')),
		s('in0000183', t('Asesinos seriales'), t('Alguien mata, y alguien lo busca')),
		s('in0000185', t('Supervivencia'), t('Salir vivo como sea')),
		s('in0000176', t('Conspiraciones'), t('Nadie es quien dice ser')),
		s('in0000181', t('Político'), t('Secretos en el poder'), true),
		s('in0000178', t('Erótico'), t('Deseo, peligro y engaño'), true),
		s('in0000180', t('Judicial'), t('Juicios con vidas en juego'), true)
	] },
	{ key: 'western', label: t('Western'), all: ['in0000191'], art: '37', subs: [
		s('in0000187', t('Clásico'), t('Vaqueros de la vieja escuela'), true),
		s('in0000188', t('Moderno'), t('El oeste, en el presente'), true),
		s('in0000190', t('Spaghetti'), t('El western a la italiana'), true),
		s('in0000189', t('Épico'), t('Grandes travesías del oeste'), true)
	] },
	{ key: 'reality', label: t('Reality'), all: ['in0000148'], art: '10764', only: 'tv', subs: [
		s('in0000144', t('Citas'), t('Buscar pareja frente a cámara')),
		s('in0000145', t('De la vida real'), t('Familias y famosos en su día a día'), true),
		s('in0000142', t('Negocios'), t('Emprendedores, ventas y tratos')),
		s('in0000143', t('Crímenes'), t('Policías y casos en vivo')),
		s('in0000147', t('Paranormal'), t('Fantasmas, casas embrujadas y cazadores'))
	] }
];

/** Los géneros que se ofrecen en ese tipo. */
export const categoriesFor = (kind: Kind): Category[] => categories().filter((c) => !c.only || c.only === kind);
export const categoryOf = (key: string | null): Category | null => categories().find((c) => c.key === key) ?? null;

/** Las interests de IMDb de una elección: los subgéneros elegidos o, si no hay, el género entero. */
export const interestsOf = (key: string | null, subs: string[]): string[] => {
	const c = categoryOf(key);
	return !c ? [] : subs.length ? subs : c.all;
};

/** Los nombres de los subgéneros de IMDb de un título que conocemos (hover de la tarjeta), en el orden de IMDb y sin
 * depender del picker: "Psicológico" de Terror sale "Terror psicológico". */
export const subgenreLabels = (ids: string[]): string[] => {
	const known = new Map<string, string>();
	for (const c of categories())
		for (const x of c.subs) {
			const full = x.withGenre ? t('{g} {s}', { g: c.label, s: x.label.toLocaleLowerCase() }) : x.label;
			known.set(x.id, full.charAt(0).toLocaleUpperCase() + full.slice(1));
		}
	return [...new Set(ids.flatMap((id) => known.get(id) ?? []))];
};
