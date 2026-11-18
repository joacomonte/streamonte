// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			langs: import('$lib/i18n/translate.js').Langs;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
