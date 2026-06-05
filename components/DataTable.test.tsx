import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DataTable from '@/components/DataTable';

interface Row {
  id: string;
  name: string;
}

const columns: DataTableColumn<Row>[] = [
  { header: 'Name', cell: (row) => row.name },
  { header: 'Id', cell: (row) => row.id },
];

const data: Row[] = [
  { id: '1', name: 'Bitcoin' },
  { id: '2', name: 'Ethereum' },
];

describe('DataTable', () => {
  it('renders a header for each column', () => {
    render(<DataTable columns={columns} data={data} rowKey={(row) => row.id} />);

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Id')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
  });

  it('renders a row per data item with cell content', () => {
    render(<DataTable columns={columns} data={data} rowKey={(row) => row.id} />);

    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByText('Ethereum')).toBeInTheDocument();
    // One header row + two body rows.
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('passes the row index to the cell renderer', () => {
    const indexed: DataTableColumn<Row>[] = [
      { header: '#', cell: (_row, index) => <span>row-{index}</span> },
    ];

    render(<DataTable columns={indexed} data={data} rowKey={(row) => row.id} />);

    expect(screen.getByText('row-0')).toBeInTheDocument();
    expect(screen.getByText('row-1')).toBeInTheDocument();
  });
});
