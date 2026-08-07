import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LogoMark } from './LogoMark'

afterEach(cleanup)

describe('LogoMark', () => {
  it('exposes a supplied product name and the mirrored tracking form', () => {
    render(<LogoMark label="MiroraTrack" />)

    expect(screen.getByRole('img', { name: 'MiroraTrack' })).toBeVisible()
    expect(screen.getByTestId('logo-mirrored-form')).toBeInTheDocument()
    expect(screen.getByTestId('logo-track-accent')).toBeInTheDocument()
  })

  it('stays outside the accessibility tree in decorative mode', () => {
    render(<LogoMark decorative />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
