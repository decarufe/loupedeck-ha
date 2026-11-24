import { describe, it, expect } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import { keyRect } from "../../src/device/regions.js";
import { createSurface, type Surface } from "../../src/render/surface.js";
import { paint, COLORS } from "../../src/render/painters.js";
import {
  EMPTY_TILE,
  type GridView,
  type TileView,
  type WeatherOutlook,
  type WeatherView,
  type FullView,
} from "../../src/views.js";
import type { OutlookPoint } from "../../src/weather/openmeteo.js";

const px = (s: Surface, x: number, y: number) =>
  Array.from(s.ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
const tile = (o: Partial<TileView>): TileView => ({
  label: "Salon",
  icon: "mdi:lightbulb",
  state: "on",
  valueText: "60 %",
  level: null,
  pending: false,
  accent: "#FFB300",
  ...o,
});
const grid = (o: Partial<GridView> = {}): GridView => ({
  kind: "grid",
  keys: Array.from({ length: 12 }, () => EMPTY_TILE),
  left: [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE],
  right: [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE],
  offline: false,
  ...o,
});
const withKey0 = (t: TileView, offline = false) =>
  grid({ keys: [t, ...Array.from({ length: 11 }, () => EMPTY_TILE)], offline });

function redJpeg(): Buffer {
  const c = createCanvas(960, 540);
  const g = c.getContext("2d");
  g.fillStyle = "#ff0000";
  g.fillRect(0, 0, 960, 540);
  return c.toBuffer("image/jpeg");
}

/** Image carrée rouge : en « contain » sur 480 × 270, elle occupe x = 105..375 avec des bandes noires de chaque côté. */
function redSquareJpeg(): Buffer {
  const c = createCanvas(200, 200);
  const g = c.getContext("2d");
  g.fillStyle = "#ff0000";
  g.fillRect(0, 0, 200, 200);
  return c.toBuffer("image/jpeg");
}

describe("painters", () => {
  it("full_cover_fills_the_screen", async () => {
    const s = createSurface();
    await paint(s, {
      kind: "full",
      image: redSquareJpeg(),
      message: null,
      stale: false,
      offline: false,
      fit: "cover",
    });
    for (const x of [2, 50, 240, 430, 477])
      expect(px(s, x, 135)[0]).toBeGreaterThan(200);
  });

  it("full_contain_whole_image_centered_with_black_bars", async () => {
    const s = createSurface();
    await paint(s, {
      kind: "full",
      image: redSquareJpeg(),
      message: null,
      stale: false,
      offline: false,
      fit: "contain",
    });
    // Bandes noires à gauche (0..104) et à droite (376..479), sur toute la hauteur.
    for (const [x, y] of [
      [0, 0],
      [50, 135],
      [100, 269],
      [380, 10],
      [430, 135],
      [479, 269],
    ] as const) {
      expect(px(s, x, y)).toEqual([0, 0, 0]);
    }
    // Image entière : centre et bords haut/bas de l'image sont rouges.
    for (const [x, y] of [
      [240, 135],
      [110, 2],
      [370, 267],
    ] as const) {
      const [r, g] = px(s, x, y);
      expect(r).toBeGreaterThan(200);
      expect(g).toBeLessThan(50);
    }
  });

  it("full_contain_with_message_draws_no_text", async () => {
    const withMsg = createSurface();
    const without = createSurface();
    const image = redSquareJpeg();
    await paint(withMsg, {
      kind: "full",
      image,
      message: "Texte",
      stale: false,
      offline: false,
      fit: "contain",
    });
    await paint(without, {
      kind: "full",
      image,
      message: null,
      stale: false,
      offline: false,
      fit: "contain",
    });
    expect(
      Buffer.from(withMsg.ctx.getImageData(0, 0, 480, 270).data).equals(
        Buffer.from(without.ctx.getImageData(0, 0, 480, 270).data),
      ),
    ).toBe(true);
  });

  it("grid_on_tile_uses_accent", async () => {
    const s = createSurface();
    await paint(s, withKey0(tile({})));
    expect(px(s, 64, 4)).toEqual([255, 179, 0]);
  });
  it("grid_off_tile", async () => {
    const s = createSurface();
    await paint(s, withKey0(tile({ state: "off" })));
    expect(px(s, 64, 4)).toEqual([0x20, 0x20, 0x20]);
  });
  it("grid_offline_desaturates", async () => {
    const s = createSurface();
    await paint(s, withKey0(tile({}), true));
    const [r, g, b] = px(s, 64, 4);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(0);
    // pastille rouge conservée en couleur
    expect(px(s, 2, 2)).toEqual([0xb0, 0x00, 0x20]);
  });
  it("dimmer_level_bar", async () => {
    const s = createSurface();
    const v = grid({ left: [EMPTY_TILE, tile({ level: 0.6 }), EMPTY_TILE] });
    await paint(s, v);
    expect(px(s, 4 + 26, 90 + 90 - 3)).toEqual([255, 255, 255]);
    expect(px(s, 4 + 45, 177)).not.toEqual([255, 255, 255]);
    expect(COLORS.bar).toBe("#FFFFFF");
  });
  it("grid_text_does_not_overflow_tile", async () => {
    const s = createSurface();
    await paint(
      s,
      withKey0(
        tile({
          label: "Un libellé extrêmement long qui déborde",
          valueText: "Valeur très très longue aussi",
        }),
      ),
    );
    // la touche 1 (x 150..240) reste noire
    const d = s.ctx.getImageData(150, 0, 90, 90).data;
    expect(
      Array.from(d)
        .filter((_, i) => i % 4 < 3)
        .every((v) => v === 0),
    ).toBe(true);
  });
  it("full_image_scaled", async () => {
    const s = createSurface();
    const v: FullView = {
      kind: "full",
      image: redJpeg(),
      message: null,
      stale: false,
      offline: false,
    };
    await paint(s, v);
    const [r, g] = px(s, 240, 135);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(50);
  });
  it("full_stale_keeps_colour_offline_grayscale", async () => {
    // Image figée : c'est la tuile compteur qui le signale ; l'image garde ses couleurs.
    const stale = createSurface();
    await paint(stale, {
      kind: "full",
      image: redJpeg(),
      message: null,
      stale: true,
      offline: false,
      fit: "cover",
    });
    const [r0, g0] = px(stale, 240, 135);
    expect(r0).toBeGreaterThan(g0! + 50);
    const s = createSurface();
    await paint(s, {
      kind: "full",
      image: redJpeg(),
      message: null,
      stale: false,
      offline: true,
      fit: "cover",
    });
    const [r, g, b] = px(s, 240, 135);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(0);
  });

  it("full_paints_age_tile_top_left", async () => {
    const s = createSurface();
    await paint(s, {
      kind: "full",
      image: redJpeg(),
      message: null,
      stale: true,
      offline: false,
      fit: "cover",
      age: { text: "42 s", level: "bad", busy: null },
    });
    // Bordure rouge de la tuile dans la zone haut gauche, image intacte ailleurs.
    const [r, g, b] = px(s, 4, 45);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(120);
    expect(b).toBeLessThan(120);
  });
  it("full_invalid_jpeg_shows_message", async () => {
    const s = createSurface();
    await expect(
      paint(s, {
        kind: "full",
        image: Buffer.from("nope"),
        message: null,
        stale: false,
        offline: false,
      }),
    ).resolves.toBeUndefined();
    const d = s.ctx.getImageData(0, 120, 480, 30).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! + d[i + 1]! + d[i + 2]! > 0) lit++;
    expect(lit).toBeGreaterThan(0);
  });
  it("graph_page_paints_curve_hints_and_scrollbar", async () => {
    const s = createSurface();
    const t0 = 1_000_000;
    await paint(s, {
      kind: "graph",
      title: "Conso",
      valueText: "1 240 W",
      subtitle: "12 h · en direct · échelle ×1",
      color: "#FF0000",
      points: [
        { t: t0, v: 0 },
        { t: t0 + 500, v: 10 },
        { t: t0 + 1000, v: 5 },
      ],
      start: t0,
      end: t0 + 1000,
      lo: -1,
      hi: 11,
      decimals: 0,
      xLabels: ["il y a 12 h", "il y a 6 h", "maintenant"],
      scroll: { from: 0.5, width: 0.25 },
      hints: { L0: { glyph: "↕", title: "Échelle V", sub: "×1" } },
      message: null,
      offline: false,
    });
    // Courbe rouge dans la zone du graphique, barre de défilement rouge en bas, indication dans la zone de la molette.
    let red = 0;
    const d = s.ctx.getImageData(100, 50, 312, 186).data;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! > 200 && d[i + 1]! < 80) red++;
    expect(red).toBeGreaterThan(100);
    const [r] = px(s, 100 + 0.6 * 312, 259);
    expect(r).toBeGreaterThan(200);
    const hint = s.ctx.getImageData(0, 0, 60, 90).data;
    let lit = 0;
    for (let i = 0; i < hint.length; i += 4)
      if (hint[i]! + hint[i + 1]! + hint[i + 2]! > 100) lit++;
    expect(lit).toBeGreaterThan(20);
  });

  it("weather_paints_update_zone_top_right", async () => {
    const s = createSurface();
    await paint(s, {
      kind: "weather",
      current: null,
      days: [],
      message: null,
      offline: false,
      updated: { text: "22 nov., 22 h 48", busy: false },
    });
    const d = s.ctx.getImageData(420, 0, 60, 90).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! + d[i + 1]! + d[i + 2]! > 300) lit++;
    expect(lit).toBeGreaterThan(20);
  });

  it("tiles_have_gaps_and_rounded_corners", async () => {
    const s = createSurface();
    await paint(s, withKey0(tile({})));
    expect(px(s, 60, 45)).toEqual([0, 0, 0]); // écart à gauche de la touche
    expect(px(s, 62, 2)).toEqual([0, 0, 0]); // coin arrondi
    expect(px(s, 105, 45)).toEqual([255, 179, 0]);
  });

  it("grid_paints_big_and_graph_tiles", async () => {
    const s = createSurface();
    const base = {
      icon: null,
      state: "off" as const,
      level: null,
      pending: false,
      accent: "#00FF00",
    };
    const keys = Array.from({ length: 12 }, () => ({
      ...base,
      label: "",
      state: "empty" as const,
      valueText: null,
    }));
    keys[0] = {
      ...base,
      label: "Ext",
      valueText: "-3,6 °C",
      layout: "big",
    } as never;
    keys[1] = {
      ...base,
      label: "CPU",
      valueText: "23 %",
      layout: "graph",
      sub: "6h",
      spark: { values: [1, 5, 2, 8], style: "area" },
    } as never;
    await paint(s, { kind: "grid", keys, left: [], right: [], offline: false });
    // Barre de couleur au bas de la touche Valeur, courbe verte dans la touche Graphique.
    const [, g0] = px(s, 105, 86);
    expect(g0).toBeGreaterThan(200);
    let green = 0;
    const d = s.ctx.getImageData(150, 50, 90, 40).data;
    for (let i = 0; i < d.length; i += 4)
      if (d[i + 1]! > 150 && d[i]! < 100) green++;
    expect(green).toBeGreaterThan(20);
  });

  it("weather_paints_current", async () => {
    const s = createSurface();
    const v: WeatherView = {
      kind: "weather",
      current: {
        icon: "mdi:weather-sunny",
        temperature: "19,5 °C",
        apparent: "Ressenti 18,0 °C",
        condition: "Ensoleillé",
      },
      days: [
        { label: "Lun", icon: "mdi:weather-cloudy", high: "20°", low: "10°" },
      ],
      message: null,
      offline: false,
    };
    await paint(s, v);
    const d = s.ctx.getImageData(60, 0, 360, 90).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! + d[i + 1]! + d[i + 2]! > 0) lit++;
    expect(lit).toBeGreaterThan(100);
  });
});

describe("météo : graphique des précipitations (touches 9 à 11)", () => {
  const HOUR = 3_600_000;
  const NOW = Date.UTC(2026, 10, 20, 15);
  const RAIN = [0x2f, 0x80, 0xed];
  const SNOW = [0xe8, 0xf4, 0xff];
  const opt = (t: number, over: Partial<OutlookPoint> = {}): OutlookPoint => ({
    t,
    temp: 2,
    feels: 2,
    mm: 0,
    kind: "none",
    prob: null,
    ...over,
  });
  const view = (
    points: OutlookPoint[],
    over: Partial<WeatherOutlook> = {},
  ): WeatherView => ({
    kind: "weather",
    current: null,
    days: [],
    message: null,
    offline: false,
    outlook: {
      points,
      start: NOW - 8 * HOUR,
      now: NOW,
      end: NOW + 4 * HOUR,
      stale: false,
      message: null,
      ...over,
    },
  });
  const barX = (t: number) =>
    150 + ((t - (NOW - 8 * HOUR)) / (12 * HOUR)) * 270;
  /** Une valeur datée T couvre l'heure précédente : la barre va de T − 1 h à T. */
  const centerX = (t: number) => Math.round((barX(t - HOUR) + barX(t)) / 2);
  const BASE = 251; // ligne de base des barres (11 px de bande de temps, puis 8 px masqués par le cadre)
  const BOTTOM = BASE - 3;
  const FUTURE_BG = [0x1b, 0x1d, 0x21];

  it("barre_de_pluie_passee_pleine_hauteur", async () => {
    const t = NOW - 2 * HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 2, kind: "rain" })]));
    expect(px(s, centerX(t), BOTTOM)).toEqual(RAIN);
    expect(px(s, centerX(t), BASE - 36)).toEqual(RAIN); // pleine hauteur = 39 px
  });

  it("barre_de_neige_blanc_glace", async () => {
    const t = NOW - 4 * HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 2, kind: "snow" })]));
    expect(px(s, centerX(t), BOTTOM)).toEqual(SNOW);
  });

  it("flocon_au_dessus_de_la_barre_de_neige", async () => {
    const t = NOW - 4 * HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 2, kind: "snow" })]));
    const d = s.ctx.getImageData(centerX(t) - 8, 197, 16, 13).data; // juste au-dessus du sommet de la barre (212)
    let lit = 0;
    for (let i = 0; i < d.length; i += 4)
      if (d[i]! > 200 && d[i + 1]! > 200 && d[i + 2]! > 200) lit++;
    expect(lit).toBeGreaterThan(8);
  });

  it("barre_melange_alterne_pluie_et_neige", async () => {
    const t = NOW - 3 * HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 2, kind: "mix" })]));
    const seen = new Set<string>();
    const x0 = Math.round(barX(t - HOUR)) + 1;
    for (let x = x0; x < x0 + 20; x++) seen.add(px(s, x, BOTTOM).join(","));
    expect(seen.has(RAIN.join(","))).toBe(true);
    expect(seen.has(SNOW.join(","))).toBe(true);
  });

  it("petite_pluie_reste_visible", async () => {
    const t = NOW - HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 0.2, kind: "rain" })]));
    expect(px(s, centerX(t), BASE - 1)).toEqual(RAIN);
    expect(px(s, centerX(t), BASE - 3)).toEqual(RAIN); // 0,2 mm sur 2 mm = 10 % de 39 px
  });

  it("valeur_datee_maintenant_finit_au_trait_maintenant", async () => {
    const s = createSurface();
    await paint(s, view([opt(NOW, { mm: 2, kind: "rain" })]));
    expect(px(s, 320, BOTTOM)).toEqual(RAIN); // l'heure écoulée est à gauche du trait
    expect(px(s, 340, BOTTOM)).toEqual(FUTURE_BG); // rien à droite : seulement le fond du futur
  });

  it("valeur_datee_dans_une_heure_commence_au_trait_maintenant", async () => {
    const s = createSurface();
    await paint(s, view([opt(NOW + HOUR, { mm: 2, kind: "rain", prob: 100 })]));
    expect(px(s, 320, BOTTOM)).toEqual([0, 0, 0]); // rien à gauche
    expect(px(s, 340, BOTTOM)).not.toEqual(FUTURE_BG); // la prévision commence à droite
  });

  it("heure_passee_sans_precipitation_mesuree_na_pas_de_barre", async () => {
    const t = NOW - 2 * HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 0, kind: "rain", prob: 60 })]));
    expect(px(s, centerX(t), BASE - 1)).toEqual([0, 0, 0]); // même pas la barre minimale de 2 px
  });

  it("le_maximum_grandit_au_dela_de_2_mm", async () => {
    const a = NOW - 3 * HOUR;
    const b = NOW - 2 * HOUR;
    const s = createSurface();
    await paint(
      s,
      view([opt(a, { mm: 8, kind: "rain" }), opt(b, { mm: 4, kind: "rain" })]),
    );
    expect(px(s, centerX(a), 225)).toEqual(RAIN); // 8 mm = pleine hauteur
    expect(px(s, centerX(b), 225)).toEqual([0, 0, 0]); // 4 mm = moitié (sommet vers 231)
  });

  it("trait_maintenant_entre_les_touches_10_et_11", async () => {
    const s = createSurface();
    await paint(s, view([opt(NOW - HOUR)]));
    let lit = 0;
    for (let y = 182; y < 200; y++)
      if (px(s, 330, y).some((c) => c > 60)) lit++;
    expect(lit).toBeGreaterThan(4);
  });

  it("lignes_de_temperature_et_zone_ressentie", async () => {
    const pts = Array.from({ length: 12 }, (_, i) =>
      opt(NOW - 8 * HOUR + i * HOUR, {
        temp: 5 + i * 0.1,
        feels: -5 + i * 0.1,
      }),
    );
    const s = createSurface();
    await paint(s, view(pts));
    const d = s.ctx.getImageData(150, 186, 270, 53).data;
    let amber = 0;
    let orange = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i]! > 200 && d[i + 1]! > 140 && d[i + 2]! < 60) amber++;
      if (d[i]! > 200 && d[i + 1]! > 80 && d[i + 1]! < 120 && d[i + 2]! < 90)
        orange++;
    }
    expect(amber).toBeGreaterThan(100); // ligne de température
    expect(orange).toBeGreaterThan(100); // ligne ressentie
  });

  it("fond_du_futur_grise", async () => {
    const s = createSurface();
    await paint(s, view([opt(NOW - HOUR)]));
    expect(px(s, 380, 184)).toEqual(FUTURE_BG);
    expect(px(s, 200, 184)).toEqual([0, 0, 0]);
  });

  it("barre_de_prevision_desaturee", async () => {
    const t = NOW + HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 2, kind: "rain", prob: 100 })]));
    // Pluie mélangée à 55 % avec le gris #808080 : (47,128,237) → (83,128,188), nettement moins saturée.
    expect(px(s, centerX(t), BOTTOM)).toEqual([83, 128, 188]);
  });

  it("ligne_du_futur_desaturee", async () => {
    const pts = Array.from({ length: 12 }, (_, i) =>
      opt(NOW - 8 * HOUR + i * HOUR, { temp: 4.9, feels: 4.9 }),
    );
    const s = createSurface();
    await paint(s, view(pts));
    const amber = (x0: number, x1: number) => {
      const d = s.ctx.getImageData(x0, 186, x1 - x0, 53).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i]! > 240 && d[i + 1]! > 165 && d[i + 2]! < 20) n++;
      return n;
    };
    expect(amber(150, 325)).toBeGreaterThan(50);
    expect(amber(335, 395)).toBe(0);
  });

  it("opacite_de_la_prevision_suit_la_probabilite", async () => {
    const sure = NOW + HOUR;
    const douteuse = NOW + 2 * HOUR;
    const s = createSurface();
    await paint(
      s,
      view([
        opt(sure, { mm: 2, kind: "rain", prob: 100 }),
        opt(douteuse, { mm: 2, kind: "rain", prob: 30 }),
      ]),
    );
    expect(px(s, centerX(sure), BOTTOM)[2]).toBeGreaterThan(
      px(s, centerX(douteuse), BOTTOM)[2]!,
    );
    for (const t of [sure, douteuse])
      expect(px(s, centerX(t), BASE - 36)).not.toEqual(FUTURE_BG); // même hauteur
  });

  it("prevision_hauteur_en_mm", async () => {
    const past = NOW - HOUR;
    const fut = NOW + HOUR;
    const s = createSurface();
    await paint(
      s,
      view([
        opt(past, { mm: 1, kind: "rain" }),
        opt(fut, { mm: 1, kind: "rain", prob: 100 }),
      ]),
    );
    expect(px(s, centerX(past), BASE - 17)).toEqual(RAIN); // 1 mm sur 2 mm = ~19 px
    expect(px(s, centerX(past), BASE - 25)).toEqual([0, 0, 0]);
    expect(px(s, centerX(fut), BASE - 17)).not.toEqual(FUTURE_BG);
    expect(px(s, centerX(fut), BASE - 25)).toEqual(FUTURE_BG);
  });

  describe("échelles", () => {
    /** Nombre de pixels dont tous les canaux dépassent `min` (du texte clair sur fond sombre). */
    const bright = (
      s: Surface,
      x: number,
      y: number,
      w: number,
      h: number,
      min = 180,
    ) => {
      const d = s.ctx.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i]! > min && d[i + 1]! > min && d[i + 2]! > min) n++;
      return n;
    };
    const GRAY = [138, 138, 138];
    /** 12 heures de 9 °C à -2 °C : l'axe va de -2 à 9. */
    const falling = (over: Partial<WeatherOutlook> = {}) =>
      view(
        Array.from({ length: 12 }, (_, i) =>
          opt(NOW - 8 * HOUR + i * HOUR, { temp: 9 - i, feels: 9 - i }),
        ),
        over,
      );

    it("echelle_temperature_etiquettes_max_et_min", async () => {
      const s = createSurface();
      await paint(s, falling());
      expect(bright(s, 150, 186, 26, 16)).toBeGreaterThan(8); // maximum, en haut à gauche
      expect(bright(s, 150, 219, 26, 13)).toBeGreaterThan(8); // minimum, en bas à gauche
    });

    it("echelle_temperature_un_trait_par_degre", async () => {
      const s = createSurface();
      await paint(s, falling());
      let ticks = 0;
      for (let y = 186; y < 235; y++)
        if (px(s, 151, y).join() === GRAY.join()) ticks++;
      expect(ticks).toBeGreaterThanOrEqual(10); // 12 graduations de -2 à 9
    });

    it("echelle_precipitations_maximum_en_mm", async () => {
      const t = NOW - 2 * HOUR;
      const s = createSurface();
      await paint(s, view([opt(t, { mm: 3, kind: "rain" })]));
      expect(bright(s, 388, 200, 32, 16)).toBeGreaterThan(6); // « 3 mm » au-dessus du sommet de l'échelle, en haut à droite
    });

    it("echelle_precipitations_cm_seulement_avec_neige", async () => {
      const t = NOW - 2 * HOUR;
      const rain = createSurface();
      await paint(rain, view([opt(t, { mm: 2, kind: "rain" })]));
      expect(bright(rain, 388, 188, 32, 11, 200)).toBe(0);
      const snow = createSurface();
      await paint(snow, view([opt(t, { mm: 2, kind: "snow" })]));
      expect(bright(snow, 388, 188, 32, 11, 200)).toBeGreaterThan(6); // « 1,4 cm » en blanc, au-dessus de « 2 mm »
    });

    it("echelle_de_temps_traits_et_etiquettes", async () => {
      const s = createSurface();
      await paint(s, view([opt(NOW - HOUR)]));
      let ticks = 0;
      for (let x = 150; x < 420; x++)
        if (px(s, x, BASE + 1).join() === GRAY.join()) ticks++;
      expect(ticks).toBeGreaterThanOrEqual(8); // un trait par heure pleine
      expect(bright(s, 150, 254, 270, 8, 120)).toBeGreaterThan(20); // heures locales
    });

    it("rien_dans_les_8_px_du_bas_masques_par_le_cadre", async () => {
      const s = createSurface();
      await paint(s, falling());
      expect(bright(s, 150, 262, 270, 8, 60)).toBe(0);
    });

    /** Nombre de pixels de la couleur de la ligne du 0 °C sur la rangée `y`. */
    const zeroPixels = (s: Surface, y: number, x0 = 150, x1 = 420) => {
      let n = 0;
      for (let x = x0; x < x1; x++) if (px(s, x, y).join() === "0,229,255") n++;
      return n;
    };
    /** Même calcul que le graphique : la zone de température va de y = 190 à y = 231. */
    const tempY = (v: number, lo: number, hi: number) =>
      Math.round(231 - ((v - lo) / (hi - lo)) * 41);
    const flat = (temp: number, over: Partial<OutlookPoint> = {}) =>
      view(
        Array.from({ length: 13 }, (_, i) =>
          opt(NOW - 8 * HOUR + i * HOUR, { temp, feels: temp, ...over }),
        ),
      );

    it("ligne_du_zero_distinctive_dun_bord_a_lautre", async () => {
      const s = createSurface();
      await paint(s, falling());
      const y = tempY(0, -2, 9);
      expect(zeroPixels(s, y, 150, 240)).toBeGreaterThan(30);
      expect(zeroPixels(s, y, 240, 330)).toBeGreaterThan(30);
      expect(zeroPixels(s, y, 330, 420)).toBeGreaterThan(30); // pleine couleur aussi dans le futur
    });

    it("ligne_du_zero_visible_meme_si_tout_est_au_dessus_ou_au_dessous", async () => {
      const ete = createSurface();
      await paint(ete, flat(22));
      expect(zeroPixels(ete, 231)).toBeGreaterThan(100); // bas de l'échelle
      const hiver = createSurface();
      await paint(hiver, flat(-22));
      expect(zeroPixels(hiver, 190)).toBeGreaterThan(100); // haut de l'échelle
    });

    it("ligne_du_zero_passe_devant_les_barres", async () => {
      for (const kind of ["rain", "snow", "mix"] as const) {
        const s = createSurface();
        await paint(s, flat(22, { kind, mm: 2, prob: 100 }));
        expect(zeroPixels(s, 231)).toBeGreaterThan(100);
      }
    });

    it("ligne_du_zero_ne_masque_pas_une_courbe_a_zero", async () => {
      const s = createSurface();
      await paint(s, flat(0));
      const d = s.ctx.getImageData(150, 209, 180, 4).data; // axe de -1 à 1 : zéro à mi-hauteur
      let amber = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i]! > 180 && d[i + 1]! > 120 && d[i + 2]! < 60) amber++;
      expect(amber).toBeGreaterThan(30);
    });

    it("grille_aux_5_degres", async () => {
      const s = createSurface();
      await paint(s, flat(12)); // axe de 0 à 12 : lignes à 5 et 10
      const lit = (y: number, x: number) =>
        px(s, x, y).reduce((a, b) => a + b, 0);
      for (const v of [5, 10]) {
        expect(lit(tempY(v, 0, 12), 260)).toBeGreaterThan(60); // visible mais discrète
        expect(lit(tempY(v, 0, 12), 260)).toBeLessThan(260);
      }
      for (const v of [3, 7]) expect(lit(tempY(v, 0, 12), 260)).toBe(0);
      expect(lit(tempY(5, 0, 12), 370)).toBeGreaterThan(
        0x1b + 0x1d + 0x21 + 30,
      ); // aussi sur le fond du futur
    });

    it("etiquette_zero_sauf_si_elle_toucherait_le_maximum_ou_le_minimum", async () => {
      const cyan = (s: Surface) => {
        const d = s.ctx.getImageData(155, 186, 20, 50).data;
        let rows = 0;
        for (let y = 0; y < 50; y++) {
          let n = 0;
          for (let x = 0; x < 20; x++) {
            const i = (y * 20 + x) * 4;
            if (d[i]! < 90 && d[i + 1]! > 120 && d[i + 2]! > 130) n++;
          }
          if (n > 0) rows++;
        }
        return rows;
      };
      const milieu = createSurface();
      await paint(
        milieu,
        view(
          Array.from({ length: 12 }, (_, i) =>
            opt(NOW - 8 * HOUR + i * HOUR, { temp: 6 - i, feels: 6 - i }),
          ),
        ),
      );
      expect(cyan(milieu)).toBeGreaterThanOrEqual(5); // hauteur du texte « 0° »
      const bas = createSurface();
      await paint(bas, flat(22));
      expect(cyan(bas)).toBeLessThanOrEqual(3); // seulement la ligne : le minimum indique déjà 0°
    });

    it("etiquettes_de_droite_ne_masquent_pas_les_barres_de_prevision", async () => {
      const t = NOW + 4 * HOUR; // dernière heure du graphique, sous les étiquettes de droite
      const s = createSurface();
      await paint(s, view([opt(t, { mm: 2, kind: "rain", prob: 100 })]));
      expect(px(s, centerX(t), BASE - 10)).toEqual([83, 128, 188]); // pluie désaturée, sans voile sombre
      expect(px(s, centerX(t), BASE - 3)).toEqual([83, 128, 188]);
    });

    it("etiquettes_dheure_ne_chevauchent_pas_les_frontieres_de_touche", async () => {
      // « maintenant » 3 min après 14 h locales : les heures paires tombent à x ≈ 329 et 239, soit sur les frontières 330 et 240.
      const now = new Date(2026, 10, 20, 14, 3).getTime();
      const s = createSurface();
      await paint(
        s,
        view([opt(now - HOUR)], {
          start: now - 8 * HOUR,
          now,
          end: now + 4 * HOUR,
        }),
      );
      expect(bright(s, 316, 254, 28, 8, 120)).toBe(0); // « 14 h » omis
      expect(bright(s, 226, 254, 28, 8, 120)).toBe(0); // « 10 h » omis
      expect(bright(s, 150, 254, 270, 8, 120)).toBeGreaterThan(20); // les autres heures restent
      expect(px(s, 330, 258)).toEqual(FUTURE_BG); // le trait « maintenant » s'arrête à la ligne de base
    });

    it("echelles_attenuees_si_donnees_perimees", async () => {
      const s = createSurface();
      await paint(s, falling({ stale: true }));
      const d = s.ctx.getImageData(150, 186, 26, 16).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4)
        max = Math.max(max, d[i]!, d[i + 1]!, d[i + 2]!);
      expect(max).toBeLessThan(180);
    });
  });

  it("message_dans_la_touche_10_seulement", async () => {
    const s = createSurface();
    await paint(s, view([], { message: "Position inconnue" }));
    const lit = (r: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => {
      const d = s.ctx.getImageData(r.x, r.y, r.width, r.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4)
        if (d[i]! + d[i + 1]! + d[i + 2]! > 0) n++;
      return n;
    };
    expect(lit(keyRect(10))).toBeGreaterThan(20);
    expect(lit(keyRect(9))).toBe(0);
    expect(lit(keyRect(11))).toBe(0);
  });

  it("donnees_perimees_dessinees_en_grise", async () => {
    const t = NOW - 2 * HOUR;
    const s = createSurface();
    await paint(s, view([opt(t, { mm: 2, kind: "rain" })], { stale: true }));
    const [, , b] = px(s, centerX(t), BOTTOM);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(RAIN[2]! - 50);
  });

  it("jours_limites_aux_touches_4_a_8", async () => {
    const s = createSurface();
    const days = Array.from({ length: 8 }, (_, i) => ({
      label: `Lun ${i}`,
      icon: "mdi:weather-cloudy",
      high: "20°",
      low: "10°",
    }));
    await paint(s, {
      kind: "weather",
      current: null,
      days,
      message: null,
      offline: false,
    });
    const lit = (i: number) => {
      const r = keyRect(i);
      const d = s.ctx.getImageData(r.x, r.y, r.width, r.height).data;
      let n = 0;
      for (let k = 0; k < d.length; k += 4)
        if (d[k]! + d[k + 1]! + d[k + 2]! > 0) n++;
      return n;
    };
    expect(lit(8)).toBeGreaterThan(20);
    for (const i of [9, 10, 11]) expect(lit(i)).toBe(0);
  });
});

describe("painters (corrections)", () => {
  it("missing_tile_uses_unavailable_background", async () => {
    const s = createSurface();
    await paint(s, withKey0(tile({ state: "missing" })));
    expect(px(s, 64, 4)).toEqual([0x3a, 0x3a, 0x3a]);
  });
  it("key_tile_has_no_level_bar", async () => {
    const s = createSurface();
    await paint(s, withKey0(tile({ level: 0.6 })));
    // Bas de la touche (à l'intérieur des coins arrondis) : couleur de la touche, pas de barre blanche.
    expect(px(s, 75, 86)).toEqual([255, 179, 0]);
    expect(px(s, 90, 86)).toEqual([255, 179, 0]);
  });
  it("strip_bar_ends_at_round_level_52", async () => {
    const s = createSurface();
    await paint(
      s,
      grid({ left: [EMPTY_TILE, tile({ level: 0.6 }), EMPTY_TILE] }),
    );
    expect(px(s, 4 + 30, 177)).toEqual([255, 255, 255]);
    expect(px(s, 4 + 31, 177)).not.toEqual([255, 255, 255]);
  });
  it("full_image_with_message_draws_no_text", async () => {
    const withMsg = createSurface();
    const without = createSurface();
    const image = redJpeg();
    await paint(withMsg, {
      kind: "full",
      image,
      message: "Texte",
      stale: false,
      offline: false,
    });
    await paint(without, {
      kind: "full",
      image,
      message: null,
      stale: false,
      offline: false,
    });
    const a = withMsg.ctx.getImageData(0, 240, 480, 30).data;
    const b = without.ctx.getImageData(0, 240, 480, 30).data;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
  it("empty_tile_with_label_draws_text_inside_tile", async () => {
    const s = createSurface();
    await paint(
      s,
      grid({
        keys: [
          { ...EMPTY_TILE, label: "Aucun thermostat" },
          ...Array.from({ length: 11 }, () => EMPTY_TILE),
        ],
      }),
    );
    const inTile = s.ctx.getImageData(60, 0, 90, 90).data;
    let lit = 0;
    for (let i = 0; i < inTile.length; i += 4)
      if (inTile[i]! + inTile[i + 1]! + inTile[i + 2]! > 0) lit++;
    expect(lit).toBeGreaterThan(20);
    const next = s.ctx.getImageData(150, 0, 90, 90).data;
    expect(next.every((v, i) => i % 4 === 3 || v === 0)).toBe(true);
  });
  it("empty_tile_without_label_stays_black", async () => {
    const s = createSurface();
    await paint(s, grid());
    const all = s.ctx.getImageData(60, 0, 90, 90).data;
    expect(all.every((v, i) => i % 4 === 3 || v === 0)).toBe(true);
  });
});

describe("painters (aucun texte sur une frontière de case)", () => {
  const VX = [60, 150, 240, 330, 420];
  const HY = [90, 180];
  /** Pixels des bandes de 2 px centrées sur les frontières, filtrés par `keep` (r,g,b). */
  function boundaryHits(
    s: Surface,
    keep: (r: number, g: number, b: number) => boolean,
  ): string[] {
    const hits: string[] = [];
    const d = s.ctx.getImageData(0, 0, 480, 270).data;
    const test = (x: number, y: number) => {
      const i = (y * 480 + x) * 4;
      if (keep(d[i]!, d[i + 1]!, d[i + 2]!)) hits.push(`${x},${y}`);
    };
    for (const bx of VX)
      for (const x of [bx - 1, bx]) for (let y = 0; y < 270; y++) test(x, y);
    for (const by of HY)
      for (const y of [by - 1, by]) for (let x = 60; x < 420; x++) test(x, y);
    return hits;
  }
  const nonBlack = (r: number, g: number, b: number) => r + g + b > 0;
  // Les fonds de tuile colorés touchent légitimement les frontières : sur les grilles on ne
  // regarde que les pixels clairs (luminance > 128), c'est-à-dire le texte sur fond sombre.
  const light = (r: number, g: number, b: number) =>
    0.299 * r + 0.587 * g + 0.114 * b > 128;

  const weather: WeatherView = {
    kind: "weather",
    current: {
      icon: "mdi:weather-sunny",
      temperature: "19,5 °C",
      apparent: "Ressenti 18,0 °C",
      condition: "Ensoleillé avec quelques passages nuageux",
    },
    days: Array.from({ length: 8 }, (_, i) => ({
      label: `Lun ${i}`,
      icon: "mdi:weather-cloudy",
      high: "20°",
      low: "10°",
    })),
    message: null,
    offline: false,
  };
  const msg = "Aucune entité météo configurée dans la configuration";
  const darkTile = tile({
    state: "off",
    label: "Un libellé extrêmement long qui déborde",
    valueText: "Valeur très très longue",
  });

  it("weather_current_and_days_stay_off_borders", async () => {
    const s = createSurface();
    await paint(s, weather);
    expect(boundaryHits(s, nonBlack)).toEqual([]);
  });
  it("weather_message_stays_off_borders", async () => {
    const s = createSurface();
    await paint(s, { ...weather, current: null, days: [], message: msg });
    expect(boundaryHits(s, nonBlack)).toEqual([]);
  });
  it("full_message_stays_off_borders", async () => {
    const s = createSurface();
    await paint(s, {
      kind: "full",
      image: null,
      message: msg,
      stale: false,
      offline: false,
    });
    expect(boundaryHits(s, nonBlack)).toEqual([]);
  });
  it("offline_grid_text_stays_off_borders", async () => {
    const s = createSurface();
    const keys = Array.from({ length: 12 }, () => darkTile);
    const strip = [darkTile, darkTile, darkTile];
    await paint(s, grid({ keys, left: strip, right: strip, offline: true }));
    expect(boundaryHits(s, light)).toEqual([]);
  });
  it("weather_message_is_inside_key5", async () => {
    const s = createSurface();
    await paint(s, { ...weather, current: null, days: [], message: msg });
    const d = s.ctx.getImageData(0, 0, 480, 270).data;
    const k = keyRect(5);
    let lit = 0;
    for (let y = 0; y < 270; y++)
      for (let x = 0; x < 480; x++) {
        const i = (y * 480 + x) * 4;
        if (d[i]! + d[i + 1]! + d[i + 2]! === 0) continue;
        lit++;
        expect(
          x >= k.x + 4 &&
            x < k.x + k.width - 4 &&
            y >= k.y + 4 &&
            y < k.y + k.height - 4,
        ).toBe(true);
      }
    expect(lit).toBeGreaterThan(50);
  });
  it("weather_current_one_item_per_key", async () => {
    const s = createSurface();
    await paint(s, { ...weather, days: [] });
    for (let i = 0; i < 4; i++) {
      const k = keyRect(i);
      const d = s.ctx.getImageData(k.x, k.y, k.width, k.height).data;
      let lit = 0;
      for (let j = 0; j < d.length; j += 4)
        if (d[j]! + d[j + 1]! + d[j + 2]! > 0) lit++;
      expect(lit).toBeGreaterThan(20);
    }
  });
});
