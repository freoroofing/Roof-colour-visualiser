// Roof colour chart: Dulux "Love Your Roof" colour card.
//
// Values were sampled from the colour card's swatches. Screens can't show
// paint colours exactly, so these are a guide only.
// Colorbond colours appear in several groups, as they do on the card; they
// all use one value (COLORBOND below) so they always match.
(() => {
  const COLORBOND = {
    "Classic Cream": "#EBDDBC",
    "Paperbark": "#CCC1A7",
    "Dune": "#B3AEA5",
    "Wallaby": "#807D79",
    "Evening Haze": "#C6C3AC",
    "Cove": "#A7A08C",
    "Mangrove": "#737663",
    "Windspray": "#888C8B",
    "Woodland Grey": "#494B44",
    "Cottage Green": "#254A3A",
    "Pale Eucalypt": "#7B846B",
    "Surfmist": "#E5E3D6",
    "Gully": "#877F74",
    "Jasper": "#6D6153",
    "Terrain": "#6B432D",
    "Manor Red": "#641E0E",
    "Shale Grey": "#BEC1BB",
    "Basalt": "#6D6C6E",
    "Ironstone": "#3A404A",
    "Monument": "#2E2E2F",
    "Night Sky": "#1B1B1B",
  };
  // A plain string is a Colorbond colour; [name, hex] is a Dulux colour.
  const cb = (name) => ({ name: `Colorbond ${name}`, hex: COLORBOND[name] });
  const c = (name, hex) => ({ name, hex });
  const build = (item) => (typeof item === "string" ? cb(item) : c(...item));

  const groups = [
    { name: "Cool range", note: "Over 70% Total Solar Reflection", colours: [
      ["White", "#FFFFFF"], ["Ice", "#EEEEE6"], ["Cool Grey", "#F1EEE6"],
      ["Surf White", "#F0F3E7"], ["Pearl", "#DCD3C3"], ["Storm", "#DEDFD1"],
      ["Quartz", "#FCF0DB"], ["Dusk", "#FCEFCD"], ["Haze", "#E4E3CB"],
      ["Shadow", "#EFE2BD"], ["Palmao", "#F8EBCC"], ["Windstorm", "#E6E8CF"],
    ]},
    { name: "Naturals", colours: [
      "Evening Haze", "Cove", ["Burlap", "#A29B83"], "Classic Cream", ["Cream", "#F3D6A9"],
      "Jasper", "Gully", "Paperbark", ["Afghan", "#95826F"], ["Wheat", "#CCB58A"],
    ]},
    { name: "Greys", colours: [
      ["Birch Grey", "#B5AEA4"], "Dune", "Shale Grey", ["Light Grey", "#A1A5AA"],
      ["Mid Grey", "#818183"], ["Dark Grey", "#40464D"], ["Twilight Shadow", "#3D434C"],
      "Wallaby", "Windspray", "Basalt", "Woodland Grey", ["Charcoal", "#393B3D"],
      "Monument", ["Ebonite", "#1C1B1C"],
    ]},
    { name: "Outback", colours: [
      ["Sienna", "#AA7557"], ["Terracotta", "#A46044"], ["Dark Terracotta", "#86452A"],
      ["Tuscan Red", "#82341B"], ["Ferric Red", "#60251D"], "Terrain", ["Mid Brown", "#552E1E"],
      ["Homestead", "#86433E"], ["Clay Brick", "#6A2720"], "Manor Red", ["Monarch", "#53201E"],
      ["Indian Red", "#441F1E"],
    ]},
    { name: "Forest", colours: [
      ["Rivergum", "#697366"], ["Bluegrass", "#617070"], "Ironstone", "Pale Eucalypt",
      "Mangrove", "Cottage Green", ["Brunswick Green", "#203D2A"],
      ["Mid Brunswick Green", "#223A2C"],
    ]},
    { name: "Colorbond", colours: Object.keys(COLORBOND) },
  ];

  window.ROOF_COLOUR_GROUPS = groups.map((g) => ({ ...g, colours: g.colours.map(build) }));
})();
