type MetricValues = Record<string, number>;

export class Metrics {
  private readonly counters: MetricValues = {};
  private readonly timings: MetricValues = {};

  public increment(name: string, by = 1): void {
    this.counters[name] = (this.counters[name] ?? 0) + by;
  }

  public observe(name: string, milliseconds: number): void {
    this.timings[name] = milliseconds;
  }

  public snapshot(): { counters: MetricValues; timings: MetricValues } {
    return { counters: { ...this.counters }, timings: { ...this.timings } };
  }
}
