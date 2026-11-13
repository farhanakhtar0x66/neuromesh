my react search bar fires an api call on every keystroke using useEffect and debounce, but when the user types 'react' slowly and then deletes back to 're' fast, the old slow response for 'react' resolves last and overwrites the UI results for 're'. fix my hook using AbortController and make sure rapid re-renders dont leak memory

Write the fixed hook to useSearch.js (an explanation may go in ANSWER.md).
