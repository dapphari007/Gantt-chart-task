import dayjs from "dayjs"

enum TimeIntervalUnitType {
  YEAR = "year",
  DECADE = "decade",
  QUARTER = "quarter",
  MONTH = "month",
  WEEK = "week",
  DAY = "day",
  HOUR = "hour",
  MINUTE = "minute",
}

interface IHeaderLevel {
  type: TimeIntervalUnitType
  interval?: number
}

const DEFAULT_FORMAT_UNITS = [
  { type: TimeIntervalUnitType.YEAR, format: ["YYYY", "yy"], isRequired: false },
  { type: TimeIntervalUnitType.YEAR, format: ["YYYY", "yy"], isRequired: true },
  { type: TimeIntervalUnitType.QUARTER, format: ["[Q]Q"], isRequired: false },
  { type: TimeIntervalUnitType.MONTH, format: ["MMMM", "MMM"], isRequired: true },
  { type: TimeIntervalUnitType.WEEK, format: ["ww"], isRequired: false },
  { type: TimeIntervalUnitType.DAY, format: ["dddd, DD", "ddd, DD"], isRequired: true },
  { type: TimeIntervalUnitType.HOUR, format: ["hh[h]"], isRequired: true },
  { type: TimeIntervalUnitType.MINUTE, format: ["mm[']"], isRequired: true },
]

function getFormatString(currentLevelIndex: number, levelMeta: IHeaderLevel[], iteration?: number) {
  const currentLevelUnit = levelMeta[currentLevelIndex]?.type
  let parentLevelUnit = levelMeta[currentLevelIndex - 1]?.type ?? TimeIntervalUnitType.YEAR
  const isParentUnitOccurringTwice = levelMeta[currentLevelIndex - 2]?.type === parentLevelUnit

  if (parentLevelUnit === TimeIntervalUnitType.YEAR && levelMeta[currentLevelIndex - 1]?.interval === 10) {
    parentLevelUnit = TimeIntervalUnitType.DECADE
  }

  const parentIdx = DEFAULT_FORMAT_UNITS.findIndex((item) => item.type === parentLevelUnit) + (currentLevelIndex === 0 ? 0 : 1)
  const currentIdx = DEFAULT_FORMAT_UNITS.findIndex((item) => item.type === currentLevelUnit)

  let format = ""
  let smallFormatWeight = 0

  if (currentIdx === parentIdx || isParentUnitOccurringTwice) return { format: DEFAULT_FORMAT_UNITS[currentIdx].format[0], smallFormatWeight }

  for (let idx = currentIdx; idx >= parentIdx; idx--) {
    if (parentIdx !== 0 && idx === parentIdx) continue
    const currentMeta = DEFAULT_FORMAT_UNITS[idx]
    if (currentMeta.isRequired || currentMeta.type === currentLevelUnit) {
      const formatIdx = iteration ? Math.min(iteration, currentMeta.format.length - 1) : 0
      if (format !== "") format += " "
      format += currentMeta.format[formatIdx]
      iteration = (iteration ?? 0) - (currentMeta.format.length - 1)
      if (currentMeta.format.length > 1) {
        smallFormatWeight += currentMeta.format.length - 1
      }
    }
  }
  return { format, smallFormatWeight }
}

const levels: IHeaderLevel[] = [
  { type: TimeIntervalUnitType.YEAR },
  { type: TimeIntervalUnitType.MONTH },
  { type: TimeIntervalUnitType.DAY },
]

const fmt = getFormatString(2, levels)
console.log("FORMAT:", fmt.format, dayjs().format(fmt.format))
