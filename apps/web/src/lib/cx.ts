/** Joins truthy class names. Plain module so both server and client components can use it. */
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
