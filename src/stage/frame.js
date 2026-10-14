// Pixel border images for .px panels, shared by the observer and the game pages.
import { canvas } from "./pixel.js";

export function pixelFrame(outer, mid, inner) {
  const [s, x] = canvas(12, 12);
  x.fillStyle = outer; x.fillRect(1, 0, 10, 12); x.fillRect(0, 1, 12, 10);
  x.fillStyle = mid; x.fillRect(2, 1, 8, 10); x.fillRect(1, 2, 10, 8);
  x.fillStyle = inner; x.fillRect(3, 2, 6, 8); x.fillRect(2, 3, 8, 6);
  x.fillStyle = "#1a1622"; x.fillRect(4, 4, 4, 4);
  return `url(${s.toDataURL()})`;
}
