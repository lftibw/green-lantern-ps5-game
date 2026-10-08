// Which level to load: Rushville (default) or the Gurugram city (?level=gurugram).
export const LEVEL = new URLSearchParams(location.search).get('level') === 'gurugram' ? 'gurugram' : 'rushville';
export const CITY = LEVEL === 'gurugram';
