import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LoginPage from './LoginPage'
const login = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 1 }))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null, login }) }))
afterEach(cleanup)
it('returns to the selected result after successful login', async () => {
  render(<MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/notifications/42' } }]}>
    <Routes><Route path="/login" element={<LoginPage />} />
    <Route path="/notifications/42" element={<p>원래 결과</p>} /></Routes>
  </MemoryRouter>)
  fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'one@example.com' } })
  fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'password' } })
  fireEvent.submit(screen.getByRole('button', { name: '로그인' }).closest('form'))
  await screen.findByText('원래 결과')
  expect(login).toHaveBeenCalledWith('one@example.com', 'password')
})
