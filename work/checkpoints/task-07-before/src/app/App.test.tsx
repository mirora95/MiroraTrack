import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('identifies the MiroraTrack desktop application', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', { level: 1, name: 'MiroraTrack' }),
    ).toBeInTheDocument()
  })
})
