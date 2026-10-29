// Charlotte Office Map settings. Edit this file to change the contact card or add county GIS links; no build step.
window.OFFICE_MAP_CONFIG = {
  title: "Gerard's Gold Mine",
  subtitle: "Industrial, hospitality, net lease and strip centers in VA, NC and SC",
  contact: {
    name: "Anthony Warren",
    title: "First Vice President, Car Washes, Southeast",
    office: "Matthews Charlotte office",
    phone: "980-431-4053",
    email: "anthony.warren@matthews.com"
  },
  // "Report a data problem" links open an email to this address with the property id and page link filled in.
  reportEmail: "anthony.warren@matthews.com",
  // Optional freshness notes for layers the data does not date itself, e.g. "Parcels: NC OneMap Oct 2026, VGIN Sep 2026".
  freshnessNote: "",
  // Method panel sentence on the 200-property hand check (to be replaced with the final hit rates after the rebuild).
  handCheck: "An independent check of 200 randomly drawn properties found the class right 75 percent of the time on the first set of rules. After the rules were fixed, 96 percent of those same 200 are right; a fresh sample will likely score somewhat lower, in the high 80s.",
  // Full names for the short source codes in the data (shown on cards, in the Method panel and the freshness line).
  sourceNames: {
    "NC1MAP+OVT2610": "NC OneMap statewide parcels; Overture Maps Oct 2026",
    "VGIN": "Virginia VGIN statewide parcels with local schema tables",
    "SCCNTY+OVT2610": "South Carolina county parcel files; Overture Maps Oct 2026"
  },
  // County parcel viewers keyed "STATE|County" without the word County or City (the app matches either spelling). Checked 2026-10-29.
  countyGis: {
    "NC|Mecklenburg": "https://polaris3g.mecklenburgcountync.gov/",
    "NC|Union": "https://gis.unioncountync.gov/maps/",
    "NC|Cabarrus": "https://location.cabarruscounty.us/"
  },
  // Long-hold default for the county counts and the Method text, in years.
  longHoldYears: 15,
  // Map opens here (Charlotte); zoom 9 shows the metro.
  center: [-80.84, 35.23],
  zoom: 9,
  // Zoomed out past this scale, properties draw as count squares (geohash level binLevel, 4 is about 39 by 20 km); points when zoomed in.
  binsUntilScale: 1500000,
  binLevel: 4,
  // CSV export stops here; narrow the filters for more.
  exportMax: 50000
};
