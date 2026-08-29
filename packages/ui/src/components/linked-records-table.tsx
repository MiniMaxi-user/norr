import type { ReactNode } from "react";
import { EmptyState } from "./empty-state";
import { Table, type TableAlign } from "./table";

export interface LinkedRecordsColumn<T> {
  header: ReactNode;
  align?: TableAlign;
  render: (record: T) => ReactNode;
}

export interface LinkedRecordsTableProps<T> {
  records: T[];
  getKey: (record: T) => string;
  onRowClick: (record: T) => void;
  columns: LinkedRecordsColumn<T>[];
  emptyIcon?: ReactNode;
  emptyHeading: ReactNode;
  emptyText?: ReactNode;
}

/**
 * Generic "read-only linked records" tab shape (issue #78) — an `EmptyState`
 * when there are none, otherwise a clickable `Table` whose rows navigate to
 * the linked module's own detail page. Extracted from three near-identical
 * copies on the Client detail page (Contracts/Work Orders/Quotes tabs),
 * which differed only in columns and empty-state copy/icon.
 */
export function LinkedRecordsTable<T>({
  records,
  getKey,
  onRowClick,
  columns,
  emptyIcon,
  emptyHeading,
  emptyText,
}: LinkedRecordsTableProps<T>) {
  if (records.length === 0) {
    return <EmptyState icon={emptyIcon} heading={emptyHeading} text={emptyText} />;
  }

  return (
    <Table>
      <Table.Head>
        <Table.Row>
          {columns.map((column, index) => (
            <Table.HeaderCell key={index} align={column.align}>
              {column.header}
            </Table.HeaderCell>
          ))}
        </Table.Row>
      </Table.Head>
      <Table.Body>
        {records.map((record) => (
          <Table.Row key={getKey(record)} onClick={() => onRowClick(record)}>
            {columns.map((column, index) => (
              <Table.Cell key={index} align={column.align}>
                {column.render(record)}
              </Table.Cell>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
