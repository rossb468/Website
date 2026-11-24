// Trip plan data. Edit this file to update the page; index.html and trip.js render it.
// Coordinates are [lat, lng]. Overnight stops are general areas only.
window.TRIP = {
  title: "Pennsylvania to Seattle",
  lede: "Driving cross-country with my dog Leo, an 85-pound lab mix: a fast run across the Midwest, then backroads, dirt tracks and desert camping through Colorado, Utah, Arizona, Nevada and California before heading north to Seattle.",
  updated: "November 24, 2026",
  status: "Planned route — it will change as I go.",
  totalMiles: "about 4,200",

  start: { name: "Southeastern Pennsylvania", latlng: [39.9, -76.0] },

  days: [
    {
      day: 1,
      from: "Southeastern PA",
      to: "Indianapolis",
      miles: 640,
      hours: "9.5",
      summary: "A long first push west on the Pennsylvania Turnpike and I-70.",
      overnight: { name: "Indianapolis area", latlng: [39.77, -86.16] },
      route: [[39.9, -76.0], [40.04, -76.3], [40.2, -77.2], [40.0, -78.24], [40.17, -80.25], [40.06, -80.72], [39.96, -82.99], [39.8, -84.2], [39.77, -86.16]],
      sights: [
        { name: "Wheeling, WV", latlng: [40.06, -80.72], fact: "From here west, I-70 shadows the old National Road, the first federally funded highway, begun in 1811. The Wheeling Suspension Bridge (1849) was briefly the longest suspension span in the world." }
      ]
    },
    {
      day: 2,
      from: "Indianapolis",
      to: "Salina, KS",
      miles: 675,
      hours: "10",
      summary: "Across the Mississippi and Missouri rivers and into the prairie.",
      overnight: { name: "Salina area", latlng: [38.84, -97.61] },
      route: [[39.77, -86.16], [39.47, -87.41], [39.12, -88.54], [38.63, -90.2], [38.95, -92.33], [39.1, -94.58], [39.05, -95.68], [39.03, -96.83], [38.84, -97.61]],
      sights: [
        { name: "Gateway Arch", latlng: [38.6247, -90.1848], fact: "I-70 crosses the Mississippi into Missouri within sight of the 630-foot Gateway Arch, the tallest monument in the US." },
        { name: "Flint Hills", latlng: [39.05, -96.45], fact: "West of Topeka, I-70 crosses the Flint Hills, the largest remaining stretch of tallgrass prairie in North America. Its rocky soil kept it from being plowed." }
      ]
    },
    {
      day: 3,
      from: "Salina",
      to: "Denver",
      miles: 430,
      hours: "6.5",
      summary: "A steady climb across the High Plains to the first view of the Front Range.",
      overnight: { name: "Denver area", latlng: [39.74, -104.99] },
      route: [[38.84, -97.61], [38.88, -99.33], [39.4, -101.05], [39.35, -101.71], [39.26, -103.69], [39.74, -104.99]],
      sights: [
        { name: "Mountain Time", latlng: [39.35, -101.71], fact: "Clocks go back an hour in western Kansas, around Goodland, before the Colorado line." },
        { name: "Mile High", latlng: [39.7393, -104.9848], fact: "One step on the west side of the Colorado State Capitol is marked as exactly one mile above sea level." }
      ]
    },
    {
      day: 4,
      from: "Denver",
      to: "Moab",
      miles: 380,
      hours: "6",
      extra: "plus trail time",
      summary: "Over the Continental Divide, down Glenwood Canyon, then the Colorado River road into Moab and a first dirt road in the afternoon.",
      overnight: { name: "Moab area", latlng: [38.57, -109.55], fact: "Moab grew up on the 1950s uranium boom. Arches and Canyonlands national parks sit on either side of town." },
      route: [[39.74, -104.99], [39.74, -105.51], [39.68, -105.93], [39.53, -106.22], [39.64, -106.37], [39.55, -107.32], [39.53, -107.78], [39.06, -108.55], [38.97, -109.32], [38.81, -109.3], [38.72, -109.31], [38.64, -109.41], [38.57, -109.55], [38.62, -109.69]],
      sights: [
        { name: "Eisenhower Tunnel", latlng: [39.6797, -105.9286], fact: "At about 11,158 feet, the tunnel under the Continental Divide is the highest point on the entire Interstate Highway System." },
        { name: "Vail Pass", latlng: [39.5308, -106.2169], fact: "I-70 tops out at 10,662 feet here before dropping toward the Eagle River." },
        { name: "Glenwood Canyon", latlng: [39.58, -107.2], fact: "A 12.5-mile stretch where I-70 is stacked and cantilevered along the Colorado River beneath walls up to 1,300 feet high. Finished in 1992, it was one of the last pieces of the original Interstate system." },
        { name: "Fisher Towers (Hwy 128)", latlng: [38.725, -109.3089], fact: "Utah 128 follows the Colorado River into Moab past the Fisher Towers. The tallest, the Titan, rises about 900 feet. John Ford shot westerns along this road." },
        { name: "Gemini Bridges", latlng: [38.6195, -109.6889], fact: "A 4x4 trail to a pair of side-by-side sandstone arches you can walk out onto, with a sheer drop between them." }
      ]
    },
    {
      day: 5,
      from: "Moab",
      to: "Valley of the Gods",
      miles: 200,
      hours: "4",
      extra: "plus trail time",
      summary: "Down the Shafer Trail switchbacks and along the river, then south into Bears Ears country.",
      hike: "Corona Arch, about 3 miles round trip, with a short ladder and safety cables near the end.",
      leo: "Canyonlands allows dogs inside vehicles on the Shafer Trail and Potash Road. Corona Arch is on BLM land, where leashed dogs are allowed.",
      overnight: { name: "Valley of the Gods area", latlng: [37.27, -109.84], fact: "Free-standing sandstone buttes along a 17-mile dirt road: Monument Valley's quieter neighbor, inside Bears Ears National Monument." },
      route: [[38.57, -109.55], [38.62, -109.69], [38.47, -109.81], [38.45, -109.74], [38.5, -109.66], [38.58, -109.62], [38.57, -109.55], [38.25, -109.4], [37.87, -109.34], [37.62, -109.48], [37.28, -109.55], [37.27, -109.84]],
      sights: [
        { name: "Shafer Trail", latlng: [38.4729, -109.8094], fact: "A dirt road that switchbacks about 1,500 feet down a cliff face from Island in the Sky. It started as a cattle trail and was widened in the 1950s for uranium trucks." },
        { name: "Corona Arch & Potash Road", latlng: [38.5797, -109.6197], fact: "Potash Road follows the Colorado River past petroglyph panels and dinosaur tracks. Corona Arch spans about 140 feet." }
      ]
    },
    {
      day: 6,
      from: "Valley of the Gods",
      to: "Valley of Fire",
      miles: 400,
      hours: "7.5",
      summary: "Up the Moki Dugway at sunrise, through Monument Valley, past Page and across the Arizona Strip into Nevada.",
      hike: "Horseshoe Bend, a short walk of about 1.5 miles round trip.",
      overnight: { name: "Valley of Fire area", latlng: [36.43, -114.51], fact: "Nevada's oldest state park (1935), named for red sandstone that formed from Jurassic sand dunes. Petroglyphs at Atlatl Rock are more than 2,000 years old." },
      route: [[37.27, -109.84], [37.27, -109.94], [37.23, -109.99], [37.27, -109.94], [37.15, -109.86], [37.1, -109.99], [36.73, -110.25], [36.91, -111.46], [36.88, -111.51], [37.05, -112.53], [37.18, -113.29], [37.1, -113.58], [36.93, -113.8], [36.8, -114.07], [36.43, -114.51]],
      sights: [
        { name: "Moki Dugway", latlng: [37.2738, -109.9378], fact: "Three miles of gravel switchbacks climbing about 1,100 feet up Cedar Mesa, cut in 1958 to haul uranium ore." },
        { name: "Muley Point", latlng: [37.2311, -109.994], fact: "A rim overlook above the goosenecks of the San Juan River, with Monument Valley on the horizon." },
        { name: "Forrest Gump Point", latlng: [37.1014, -109.99], fact: "The spot on US-163 where Forrest stops running, with the Monument Valley buttes lined up straight ahead." },
        { name: "Horseshoe Bend", latlng: [36.8791, -111.5104], fact: "The Colorado River loops around a sandstone point about 1,000 feet below the rim, just outside Page." },
        { name: "Virgin River Gorge", latlng: [36.93, -113.8], fact: "I-15 threads a narrow canyon across a corner of Arizona. It was one of the most expensive stretches of rural interstate ever built." }
      ]
    },
    {
      day: 7,
      from: "Valley of Fire",
      to: "Alabama Hills",
      miles: 345,
      hours: "7",
      summary: "A sunrise hike in red rock, an afternoon through Death Valley, and a night under Mt. Whitney.",
      hike: "White Domes loop, about 1.25 miles, through a short slot canyon and past the ruins of a set from the 1966 film The Professionals.",
      leo: "Valley of Fire allows leashed dogs on its trails. In Death Valley, dogs stay on roads and in developed areas.",
      overnight: { name: "Lone Pine area", latlng: [36.61, -118.1], fact: "The Alabama Hills have been the backdrop for 400+ films and TV shows, from Gunga Din to Iron Man. Civil War–era miners named them after the Confederate warship CSS Alabama." },
      route: [[36.43, -114.51], [36.17, -115.14], [36.21, -115.98], [36.3, -116.41], [36.22, -116.73], [36.42, -116.81], [36.23, -116.77], [36.37, -116.82], [36.46, -116.87], [36.61, -117.15], [36.38, -117.28], [36.34, -117.47], [36.61, -118.06]],
      sights: [
        { name: "White Domes", latlng: [36.4855, -114.5333], fact: "Cream-and-red sandstone domes at the end of Valley of Fire's scenic road." },
        { name: "Dante's View", latlng: [36.2203, -116.7268], fact: "From nearly 5,500 feet you look almost straight down to Badwater, more than a mile below." },
        { name: "Badwater Basin", latlng: [36.2306, -116.7678], fact: "Salt flats 282 feet below sea level, the lowest point in North America." },
        { name: "Artists Drive", latlng: [36.37, -116.818], fact: "A one-way loop of about 9 miles past hills tinted pink, green and purple by metal oxides." },
        { name: "Twenty Mule Team Canyon", latlng: [36.4, -116.79], fact: "A one-way dirt road of about 2.7 miles through badlands, named for the mule teams that hauled borax out of the valley." }
      ]
    },
    {
      day: 8,
      from: "Alabama Hills",
      to: "Redding",
      miles: 550,
      hours: "9.5",
      summary: "North up US-395 along the Eastern Sierra, past Mono Lake and Reno, then over Donner Summit and up the Sacramento Valley.",
      hike: "Mobius Arch loop, a short sunrise walk with Mt. Whitney framed through the arch.",
      overnight: { name: "Redding area", latlng: [40.59, -122.39] },
      route: [[36.61, -118.06], [37.36, -118.4], [37.65, -118.97], [37.96, -119.12], [38.09, -119.18], [38.26, -119.23], [38.69, -119.52], [39.16, -119.77], [39.53, -119.81], [39.33, -120.18], [39.34, -120.34], [38.9, -121.08], [38.58, -121.49], [39.15, -122.15], [40.18, -122.24], [40.59, -122.39]],
      sights: [
        { name: "Mobius Arch", latlng: [36.6097, -118.1263], fact: "A small granite arch that frames Mt. Whitney, the tallest peak in the lower 48 at 14,505 feet." },
        { name: "Mono Lake", latlng: [37.9416, -119.027], fact: "An ancient lake roughly two and a half times saltier than the ocean. Its tufa towers formed underwater and were exposed after Los Angeles began diverting the lake's streams in 1941." },
        { name: "Conway Summit", latlng: [38.088, -119.18], fact: "The highest point on US-395, just over 8,100 feet, overlooking Mono Lake." },
        { name: "Donner Summit", latlng: [39.32, -120.33], fact: "I-80 crosses the Sierra at 7,227 feet near where the Donner Party was trapped in the winter of 1846–47. The first transcontinental railroad crossed here too." }
      ]
    },
    {
      day: 9,
      from: "Redding",
      to: "Seattle",
      miles: 580,
      hours: "9.5",
      summary: "North on I-5 past Mt. Shasta and over the Siskiyous, up the Willamette Valley and across the Columbia to Seattle.",
      hike: "A morning walk on the Sacramento River Trail and across the Sundial Bridge.",
      overnight: { name: "Seattle", latlng: [47.61, -122.33], fact: "End of the road. On a clear day, Mt. Rainier rises to the southeast." },
      route: [[40.59, -122.39], [40.78, -122.32], [41.21, -122.27], [41.31, -122.31], [41.42, -122.39], [41.73, -122.63], [42.075, -122.607], [42.33, -122.87], [42.44, -123.33], [43.22, -123.34], [44.05, -123.09], [44.94, -123.04], [45.52, -122.68], [45.614, -122.677], [46.15, -122.91], [47.04, -122.9], [47.25, -122.44], [47.61, -122.33]],
      sights: [
        { name: "Sundial Bridge", latlng: [40.5928, -122.3776], fact: "A glass-decked footbridge over the Sacramento River by Santiago Calatrava. Its 217-foot pylon casts the shadow of a working sundial." },
        { name: "Mt. Shasta", latlng: [41.409, -122.195], fact: "A 14,179-foot volcano that rises right beside I-5 near Weed. It is one of the great Cascade volcanoes." },
        { name: "Siskiyou Summit", latlng: [42.075, -122.607], fact: "At 4,310 feet, the highest point on I-5, just north of the Oregon line." },
        { name: "Columbia River", latlng: [45.614, -122.677], fact: "I-5 crosses into Washington on the Interstate Bridge. Its northbound span opened in 1917." }
      ]
    }
  ]
};
