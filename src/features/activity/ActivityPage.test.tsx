import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActivityApplication } from '../../app/runtime'
import { ActivityPage } from './ActivityPage'

afterEach(cleanup)

describe('ActivityPage', () => {
  it('renders only the safe projection and applies search and pagination', async () => {
    const service: ActivityApplication = {
      list: vi.fn().mockResolvedValue({
        items: [{
          id: 'audit-private-id',
          action: 'transaction.created',
          message: 'Transaction created',
          timestamp: '2026-07-29T10:00:00.000Z',
        }],
        total: 1,
        page: 1,
        pageCount: 1,
      }),
    }
    const user = userEvent.setup()
    render(<ActivityPage service={service} />)

    expect(await screen.findByText('Transaction created')).toBeVisible()
    expect(screen.queryByText('audit-private-id')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent('C:\\')
    await user.type(screen.getByRole('textbox', { name: 'Search activity' }), 'transaction')
    await waitFor(() => expect(service.list).toHaveBeenLastCalledWith({
      search: 'transaction',
      page: 1,
      pageSize: 25,
    }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Activity rows per page' }), '50')
    await waitFor(() => expect(service.list).toHaveBeenLastCalledWith({
      search: 'transaction',
      page: 1,
      pageSize: 50,
    }))
  })
})
