import { describe, expect, it } from "vitest";
import { myQuestions } from "@/lib/dayflow-questions";
import type { Resolution } from "@/lib/dayflow";

describe("employee confirmation access", () => {
  const questions = [
    { id: "own", employee_id: "e004", lane: "waiting", state: "open" },
    { id: "other", employee_id: "e001", lane: "waiting", state: "open" },
    { id: "closed", employee_id: "e004", lane: "waiting", state: "approved" },
  ] as Resolution[];
  it("returns only the signed-in employee's open questions", () => {
    expect(myQuestions(questions, "e004").map((item) => item.id)).toEqual(["own"]);
  });
  it("returns no answerable questions without an employee identity", () => {
    expect(myQuestions(questions, null)).toEqual([]);
  });
});