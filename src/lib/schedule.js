// Escalas de trabalho: horário da casa + escala individual de cada
// profissional. Usado pelo agendamento online para ofertar apenas
// horários em que o profissional escolhido realmente atende.

// [abre, fecha] por dia da semana (0 = domingo). Dom/seg fechados.
export const BUSINESS_HOURS = {
  0: null,
  1: null,
  2: [9, 19],
  3: [9, 19],
  4: [9, 19],
  5: [9, 19],
  6: [8, 18],
};

export const SLOT_MINUTES = 30;
export const MIN_LEAD_MINUTES = 30;

const DAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// "2,3,4,5,6" + 9..15 → "ter a sáb · 9h às 15h"
export function scheduleLabel(barber) {
  const days = barber.days.split(",").map(Number).sort((a, b) => a - b);
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const daysLabel =
    contiguous && days.length > 1
      ? `${DAY_SHORT[days[0]]} a ${DAY_SHORT[days[days.length - 1]]}`
      : days.map((d) => DAY_SHORT[d]).join(", ");
  return `${daysLabel} · ${barber.startHour}h às ${barber.endHour}h`;
}

// Horários possíveis de um profissional em uma data: interseção da
// escala dele com o funcionamento da casa, em passos de 30 min,
// respeitando a antecedência mínima. null = data inválida.
export function slotsForBarberDate(barber, dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d);
  if (Number.isNaN(day.getTime())) return null;

  const business = BUSINESS_HOURS[day.getDay()];
  if (!business) return [];
  if (!barber.days.split(",").map(Number).includes(day.getDay())) return [];

  const open = Math.max(business[0], barber.startHour);
  const close = Math.min(business[1], barber.endHour);

  const slots = [];
  const cutoff = new Date(Date.now() + MIN_LEAD_MINUTES * 60 * 1000);
  for (let min = open * 60; min <= close * 60 - SLOT_MINUTES; min += SLOT_MINUTES) {
    const slot = new Date(y, m - 1, d, Math.floor(min / 60), min % 60, 0, 0);
    if (slot > cutoff) slots.push(slot);
  }
  return slots;
}
