import { Schema } from 'effect';

export const IntervalsAthleteId = Schema.String.check(Schema.isPattern(/^i?\d+$/));
export const isIntervalsAthleteId = Schema.is(IntervalsAthleteId);
