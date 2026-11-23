/** Humidex canadien (°C) d'après la température et le point de rosée. */
export function humidex(tempC: number, dewPointC: number): number {
  const e = 6.11 * Math.exp(5417.753 * (1 / 273.16 - 1 / (dewPointC + 273.16)))
  return tempC + 0.5555 * (e - 10)
}

/** Refroidissement éolien canadien (°C) ; vent à 10 m en km/h. */
export function windChill(tempC: number, windKmh: number): number {
  const p = windKmh ** 0.16
  return 13.12 + 0.6215 * tempC - 11.37 * p + 0.3965 * tempC * p
}

/** Température ressentie : refroidissement si T ≤ 0 °C et vent > 4,8 km/h, humidex s'il vaut au moins 25, sinon la température. */
export function feelsLike(tempC: number, dewPointC: number, windKmh: number): number {
  if (tempC <= 0 && windKmh > 4.8) return windChill(tempC, windKmh)
  const h = humidex(tempC, dewPointC)
  return h >= 25 ? h : tempC
}
