// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import VaultSetup from "../src/components/VaultSetup";
import { connectCloud } from "../src/cloud";
import { GB } from "../src/quota";
vi.mock("../src/cloud", () => ({ connectCloud: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const user = { id: "person-a", name: "Person", email: "person@example.com" };
const makeConnection = () => ({
  provider: "google" as const,
  account: user.email,
  list: vi.fn().mockResolvedValue([]),
  quota: vi.fn().mockResolvedValue({ total: 200 * GB, used: 88 * GB }),
});
describe("storage choice after Google sign-in", () => {
  it("creates a local vault without ever authorizing or accessing Drive", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<VaultSetup user={user} busy={false} onSubmit={save} />);
    expect(
      screen.getByText("Aucune synchronisation sur le téléphone."),
    ).toBeTruthy();
    expect(screen.queryByText("OneDrive")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Stockage local/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continuer en local" }));
    await screen.findByLabelText("Espace maximum pour Notes");
    expect(screen.queryByLabelText(/mot de passe/i)).toBeNull();
    fireEvent.submit(
      screen.getByRole("button", { name: "Commencer" }).closest("form")!,
    );
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(connectCloud).not.toHaveBeenCalled();
    expect(save.mock.calls[0][0]).toMatchObject({
      connection: null,
      open: false,
      limit: GB,
    });
  });
  it("reads112GB available from Drive and blocks a larger chosen budget", async () => {
    vi.mocked(connectCloud).mockResolvedValue(makeConnection() as never);
    const save = vi.fn();
    render(<VaultSetup user={user} busy={false} onSubmit={save} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Connecter Google Drive" }),
    );
    const limit = await screen.findByLabelText("Espace maximum pour Notes");
    expect(connectCloud).toHaveBeenCalledWith("google", "person-a");
    expect(limit.getAttribute("max")).toBe("112");
    expect(screen.getByText("112 Go disponibles sur Drive.")).toBeTruthy();
    fireEvent.change(limit, { target: { value: "113" } });
    fireEvent.submit(
      screen.getByRole("button", { name: "Commencer" }).closest("form")!,
    );
    await screen.findByRole("alert");
    expect(save).not.toHaveBeenCalled();
  });
  it("does not create a vault when Drive is already full", async () => {
    vi.mocked(connectCloud).mockResolvedValue({
      ...makeConnection(),
      quota: vi.fn().mockResolvedValue({ total: 15 * GB, used: 15 * GB }),
    } as never);
    render(<VaultSetup user={user} busy={false} onSubmit={vi.fn()} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Connecter Google Drive" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Drive est plein",
    );
    expect(screen.queryByLabelText("Mot de passe du coffre")).toBeNull();
  });
});
