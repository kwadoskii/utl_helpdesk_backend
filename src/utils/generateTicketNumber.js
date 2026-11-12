import Counter from "../models/Counter.js";

export async function generateTicketNumber() {
  try {
    const counter = await Counter.findOneAndUpdate(
      { _id: "ticketNumber" },
      { $inc: { seq: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    const ticketNumber = 10000 + counter.seq;

    return `MIS-${String(ticketNumber).padStart(5, "0")}`;
  } catch (error) {
    // Handle simultaneous first-time counter creation.
    if (error.code === 11000) {
      const counter = await Counter.findOneAndUpdate(
        { _id: "ticketNumber" },
        { $inc: { seq: 1 } },
        { new: true },
      );

      return `MIS-${String(10000 + counter.seq).padStart(5, "0")}`;
    }

    throw error;
  }
}
