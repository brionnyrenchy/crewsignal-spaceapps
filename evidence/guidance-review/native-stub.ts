export async function invoke(): Promise<never> { throw new Error('Native invocation is not available in this browser bridge harness.'); }
export async function listen(): Promise<() => void> { return () => {}; }
