import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const outputDirectory = path.resolve("assets/brand/current");
const publicBrandDirectory = path.resolve("public/brand");
const publicImagesDirectory = path.resolve("public/images");
const colors = {
  aqua: "#00CDB7",
  marineInk: "#0B1D34",
  signalYellow: "#F4C542",
  white: "#FFFFFF",
};

function normalizeSvg(source) {
  return `${source.trim().replace(/[ \t]+$/gm, "")}\n`;
}

const symbolGeometry = ({ nColor, wakeColor }) => `
  <path fill="${nColor}" d="M220 180 370 295 620 520 620 300 780 180 780 720 620 600 370 380 370 620 220 735Z"/>
  <path fill="${wakeColor}" d="M490 645 405 715 300 780 405 780Z"/>
  <path fill="${wakeColor}" d="M510 645 595 715 700 780 595 780Z"/>
  <path fill="${colors.signalYellow}" d="M500 650 540 730 500 820 460 730Z"/>
`;

const compactSymbolGeometry = ({ nColor }) => `
  <path fill="${nColor}" d="M220 180 370 295 620 520 620 300 780 180 780 720 620 600 370 380 370 620 220 735Z"/>
`;

const appIconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" role="img" aria-labelledby="title">
  <title id="title">Nautex application icon</title>
  <rect x="28" y="28" width="944" height="944" rx="190" fill="${colors.aqua}"/>
  ${symbolGeometry({ nColor: colors.white, wakeColor: colors.white })}
</svg>`;

const standaloneMarkSvg = ({ reversed = false } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="150 120 700 760" role="img" aria-labelledby="title">
  <title id="title">Nautex navigation mark</title>
  ${symbolGeometry({ nColor: colors.aqua, wakeColor: reversed ? colors.white : colors.marineInk })}
</svg>`;

const compactMarkSvg = () => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="180 140 640 640" role="img" aria-labelledby="title">
  <title id="title">Nautex compact navigation mark</title>
  ${compactSymbolGeometry({ nColor: colors.aqua })}
</svg>`;

function geometricWordmark(color) {
  return `
    <g fill="${color}">
      <rect x="430" y="150" width="45" height="200"/>
      <rect x="545" y="150" width="45" height="200"/>
      <path d="M468 150h48l39 200h-48Z"/>

      <path d="M620 350 690 150h45l-60 200Z"/>
      <path d="M705 150h45l70 200h-55Z"/>
      <rect x="671" y="268" width="98" height="28"/>

      <path d="M850 150h45v122c0 37 14 53 37 53s38-16 38-53V150h45v126c0 50-32 79-83 79s-82-29-82-79Z"/>

      <rect x="1045" y="150" width="170" height="42"/>
      <rect x="1108" y="150" width="44" height="200"/>

      <rect x="1245" y="150" width="45" height="200"/>
      <rect x="1245" y="150" width="150" height="42"/>
      <rect x="1245" y="229" width="126" height="40"/>
      <rect x="1245" y="308" width="150" height="42"/>

      <path d="M1420 150h55l115 200h-55Z"/>
      <path d="M1535 150h55l-115 200h-55Z"/>
    </g>
    <g fill="${colors.signalYellow}">
      <path d="M1641 350 1706 150h45l-55 200Z"/>
      <path d="M1721 150h45l65 200h-55Z"/>
      <rect x="1692" y="268" width="92" height="28"/>
      <rect x="1858" y="150" width="45" height="200"/>
    </g>
  `;
}

const horizontalLogoSvg = ({ reversed = false } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1940 500" role="img" aria-labelledby="title">
  <title id="title">Nautex AI</title>
  <g transform="translate(-40 0)"><g transform="scale(.5)">
    ${symbolGeometry({ nColor: colors.aqua, wakeColor: reversed ? colors.white : colors.marineInk })}
  </g></g>
  ${geometricWordmark(reversed ? colors.white : colors.marineInk)}
</svg>`;

const compactHorizontalLogoSvg = ({ reversed = false } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1940 500" role="img" aria-labelledby="title">
  <title id="title">Nautex AI compact logo</title>
  <g transform="translate(-40 0)"><g transform="scale(.5)">
    ${compactSymbolGeometry({ nColor: colors.aqua })}
  </g></g>
  ${geometricWordmark(reversed ? colors.white : colors.marineInk)}
</svg>`;

await Promise.all([
  mkdir(outputDirectory, { recursive: true }),
  mkdir(publicBrandDirectory, { recursive: true }),
  mkdir(publicImagesDirectory, { recursive: true }),
]);
const svgFiles = {
  "nautex-app-icon.svg": appIconSvg,
  "nautex-mark.svg": standaloneMarkSvg(),
  "nautex-mark-reversed.svg": standaloneMarkSvg({ reversed: true }),
  "nautex-mark-compact-reversed.svg": compactMarkSvg(),
  "nautex-logo-horizontal.svg": horizontalLogoSvg(),
  "nautex-logo-horizontal-reversed.svg": horizontalLogoSvg({ reversed: true }),
  "nautex-logo-horizontal-compact-reversed.svg": compactHorizontalLogoSvg({ reversed: true }),
};
for (const [filename, source] of Object.entries(svgFiles)) {
  const normalizedSource = normalizeSvg(source);
  await Promise.all([
    writeFile(path.join(outputDirectory, filename), normalizedSource, "utf8"),
    writeFile(path.join(publicBrandDirectory, filename), normalizedSource, "utf8"),
  ]);
}
await writeFile(path.resolve("public/favicon.svg"), normalizeSvg(appIconSvg), "utf8");

const iconPath = path.join(outputDirectory, "nautex-app-icon-1024.png");
await sharp(Buffer.from(appIconSvg)).resize(1024, 1024).png().toFile(iconPath);
for (const size of [512, 256, 128, 64, 48, 32, 24, 16]) {
  await sharp(iconPath).resize(size, size).png().toFile(path.join(outputDirectory, `nautex-app-icon-${size}.png`));
}
await sharp(iconPath).resize(256, 256).png().toFile(path.resolve("public/nautex-icon-256.png"));
await writeFile(
  path.join(outputDirectory, "nautex-app-icon.ico"),
  await pngToIco(path.join(outputDirectory, "nautex-app-icon-256.png")),
);

await sharp(Buffer.from(standaloneMarkSvg())).resize({ width: 1000 }).png().toFile(path.join(outputDirectory, "nautex-mark-1000.png"));
await sharp(Buffer.from(horizontalLogoSvg())).resize({ width: 2400 }).png().toFile(path.join(outputDirectory, "nautex-logo-horizontal-2400.png"));
await sharp(Buffer.from(horizontalLogoSvg({ reversed: true }))).resize({ width: 2400 }).png().toFile(path.join(outputDirectory, "nautex-logo-horizontal-reversed-2400.png"));
await sharp(Buffer.from(horizontalLogoSvg())).resize({ width: 250 }).png().toFile(path.join(outputDirectory, "nautex-logo-horizontal-250.png"));
await sharp(Buffer.from(horizontalLogoSvg())).resize({ width: 150 }).png().toFile(path.join(outputDirectory, "nautex-logo-horizontal-150.png"));

await sharp(Buffer.from(horizontalLogoSvg({ reversed: true })))
  .resize({ width: 1200 })
  .png()
  .toFile(path.join(publicImagesDirectory, "nautex-logo.png"));
await sharp(Buffer.from(standaloneMarkSvg({ reversed: true })))
  .resize({ width: 512 })
  .png()
  .toFile(path.join(publicImagesDirectory, "nautex-mark.png"));

console.log(`Built final Nautex brand candidate in ${path.relative(process.cwd(), outputDirectory)}.`);
