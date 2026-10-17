/** Icono de vinilo por defecto, como data URI SVG */
export const DEFAULT_COVER =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" fill="#1a1a1f"/>
      <circle cx="256" cy="256" r="200" fill="none" stroke="#3b82f6" stroke-width="4" opacity="0.6"/>
      <circle cx="256" cy="256" r="150" fill="none" stroke="#3b82f6" stroke-width="3" opacity="0.5"/>
      <circle cx="256" cy="256" r="100" fill="none" stroke="#3b82f6" stroke-width="3" opacity="0.4"/>
      <circle cx="256" cy="256" r="55" fill="#0e0e12"/>
      <circle cx="256" cy="256" r="8" fill="#3b82f6"/>
    </svg>`
  );