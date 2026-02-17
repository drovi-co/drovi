import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Card } from "./card";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Table, TableBody, TableCell, TableRow } from "./table";

describe("institutional component variants", () => {
  it("renders seal badge variant", () => {
    const { getByText } = render(<Badge variant="seal">Verified</Badge>);
    const badge = getByText("Verified");
    expect(badge.className).toContain("tracking-[0.08em]");
  });

  it("renders dossier card variant", () => {
    const { container } = render(<Card variant="dossier">Dossier</Card>);
    const card = container.querySelector("[data-slot='card']");
    expect(card?.getAttribute("data-variant")).toBe("dossier");
  });

  it("renders institutional table variant", () => {
    const { container } = render(
      <Table variant="institutional">
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );

    const table = container.querySelector("[data-slot='table']");
    expect(table?.getAttribute("data-variant")).toBe("institutional");
  });

  it("renders evidence popover variant", () => {
    render(
      <Popover open>
        <PopoverTrigger asChild>
          <button type="button">Open</button>
        </PopoverTrigger>
        <PopoverContent variant="evidence">Evidence</PopoverContent>
      </Popover>
    );

    const popover = document.querySelector("[data-slot='popover-content']");
    expect(popover?.getAttribute("data-variant")).toBe("evidence");
  });

  it("keeps institutional class snapshots stable", () => {
    const badge = render(<Badge variant="seal">Seal</Badge>).container
      .firstElementChild as HTMLElement;
    expect(badge.className).toMatchSnapshot("badge-seal-classes");

    const card = render(<Card variant="dossier">Dossier</Card>).container
      .firstElementChild as HTMLElement;
    expect(card.className).toMatchSnapshot("card-dossier-classes");

    const table = render(
      <Table variant="institutional">
        <TableBody>
          <TableRow>
            <TableCell>Row</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ).container.firstElementChild as HTMLElement;
    expect(table.className).toMatchSnapshot("table-institutional-classes");
  });
});
