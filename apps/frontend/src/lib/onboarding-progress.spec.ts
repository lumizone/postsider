import {
  onboardingProgressKey,
  readOnboardingProgress,
  saveOnboardingProgress,
  markOnboardingCompleted,
} from "./onboarding-progress";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => values.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn((key: string) => values.delete(key)),
    values,
  };
}

const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    localStorage: fakeStorage(),
  };
});

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("intent is scoped to both user and organization", () => {
  saveOnboardingProgress("user-A", "org-1", {
    intent: "agents", completed: false, dismissed: false,
  });
  expect(readOnboardingProgress("user-A", "org-1")).toEqual({
    intent: "agents", completed: false, dismissed: false,
  });
  expect(readOnboardingProgress("user-B", "org-1")).toBeNull();
  expect(readOnboardingProgress("user-A", "org-2")).toBeNull();
  expect(onboardingProgressKey("user-A", "org-1"))
    .not.toBe(onboardingProgressKey("user-A", "org-2"));
});

test("social path stays separate and completion is idempotent", () => {
  saveOnboardingProgress("user-A", "org-1", {
    intent: "social", completed: false, dismissed: false,
  });
  markOnboardingCompleted("user-A", "org-1");
  markOnboardingCompleted("user-A", "org-1");
  expect(readOnboardingProgress("user-A", "org-1")).toEqual({
    intent: "social", completed: true, dismissed: true,
  });
});

test("agent intent remains incomplete if only reminder is dismissed", () => {
  saveOnboardingProgress("user-A", "org-1", {
    intent: "agents", completed: false, dismissed: true,
  });
  expect(readOnboardingProgress("user-A", "org-1")).toMatchObject({
    intent: "agents", completed: false, dismissed: true,
  });
});

test("missing, invalid and stale storage are handled without a crash", () => {
  const storage = (globalThis as any).window.localStorage;
  expect(readOnboardingProgress("u", "o")).toBeNull();
  storage.setItem(onboardingProgressKey("u", "o"), "{corrupt");
  expect(readOnboardingProgress("u", "o")).toBeNull();
  storage.setItem(onboardingProgressKey("u", "o"), '{"intent":"unknown","completed":true}');
  expect(readOnboardingProgress("u", "o")).toBeNull();
  storage.setItem(onboardingProgressKey("u", "o"), '{"intent":"agents"}');
  expect(readOnboardingProgress("u", "o")).toEqual({
    intent: "agents", completed: false, dismissed: false,
  });
});

test("browser storage restrictions do not block onboarding", () => {
  (globalThis as any).window.localStorage = {
    getItem: () => { throw Error("private mode"); },
    setItem: () => { throw Error("private mode"); },
  };
  expect(() => saveOnboardingProgress("u", "o", {
    intent: "agents", completed: false, dismissed: false,
  })).not.toThrow();
  expect(readOnboardingProgress("u", "o")).toBeNull();
});

test("no session or user identity means no storage access", () => {
  const storage = (globalThis as any).window.localStorage;
  saveOnboardingProgress(null, "org-1", {
    intent: "agents", completed: false, dismissed: false,
  });
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(readOnboardingProgress("user-A", null)).toBeNull();
});
