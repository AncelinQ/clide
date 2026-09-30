/**
 * Nombre limité de relances automatiques sur une fenêtre de temps glissante.
 *
 * Une page qui meurt à chaque chargement serait sinon relancée sans fin : une
 * fois le budget épuisé, c'est à l'utilisateur de décider.
 */
export class RetryBudget {
  private readonly attempts: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Vrai si une relance reste permise, et la compte. */
  take(): boolean {
    const now = this.now();
    while (this.attempts.length > 0 && now - (this.attempts[0] ?? 0) >= this.windowMs) this.attempts.shift();
    if (this.attempts.length >= this.max) return false;
    this.attempts.push(now);
    return true;
  }
}
