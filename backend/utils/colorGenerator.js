/**
 * Generate color shades from a primary color using HSLA
 * @param {string} hexColor - Primary color in hex format (#RRGGBB)
 * @returns {object} Object with light, lighter, dark, darker shades in HSLA format
 */

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0; // achromatic
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
      default: h = 0;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

function hslToHsla(h, s, l, a = 1) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

function generateColorShades(primaryColor) {
  const rgb = hexToRgb(primaryColor);
  if (!rgb) {
    // Fallback to hex if conversion fails
    return {
      light: lightenColor(primaryColor, 0.3),
      lighter: lightenColor(primaryColor, 0.5),
      dark: darkenColor(primaryColor, 0.2),
      darker: darkenColor(primaryColor, 0.4)
    };
  }

  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  
  return {
    light: hslToHsla(hsl.h, hsl.s, Math.min(95, hsl.l + 20), 1),
    lighter: hslToHsla(hsl.h, hsl.s, Math.min(98, hsl.l + 30), 1),
    dark: hslToHsla(hsl.h, hsl.s, Math.max(5, hsl.l - 15), 1),
    darker: hslToHsla(hsl.h, hsl.s, Math.max(5, hsl.l - 25), 1)
  };
}

// Legacy RGB functions for fallback
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

function lightenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const r = Math.min(255, Math.round(rgb.r + (255 - rgb.r) * percent));
  const g = Math.min(255, Math.round(rgb.g + (255 - rgb.g) * percent));
  const b = Math.min(255, Math.round(rgb.b + (255 - rgb.b) * percent));
  
  return rgbToHex(r, g, b);
}

function darkenColor(hex, percent) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  
  const r = Math.max(0, Math.round(rgb.r * (1 - percent)));
  const g = Math.max(0, Math.round(rgb.g * (1 - percent)));
  const b = Math.max(0, Math.round(rgb.b * (1 - percent)));
  
  return rgbToHex(r, g, b);
}

module.exports = {
  generateColorShades,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToHsla,
  lightenColor,
  darkenColor
};
