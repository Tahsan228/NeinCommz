export type Mark = 'X' | 'O' | '';
export type Board = Mark[];

export const LINES: [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function emptyBoard(): Board {
  return ['', '', '', '', '', '', '', '', ''];
}

/**
 * Mirrors the ttt_winner function in the database. The server is what actually
 * decides a game; this copy exists so the board can be styled and the turn
 * banner written without waiting for a round trip.
 */
export function winner(board: Board): Mark | 'draw' | null {
  for (const [a, b, c] of LINES) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return board[a];
  }
  return board.every((c) => c !== '') ? 'draw' : null;
}

export function winningLine(board: Board): [number, number, number] | null {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[b] === board[c]) return line;
  }
  return null;
}

export function isLegalMove(board: Board, cell: number): boolean {
  return cell >= 0 && cell < 9 && board[cell] === '';
}
