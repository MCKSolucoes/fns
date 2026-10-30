import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectLocalData, migrateLocalData } from './localDataMigration.js'

function useMemoryLocalStorage() {
	const values = new Map<string, string>()
	const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value),
			removeItem: (key: string) => values.delete(key),
		},
	})
	return () => {
		if (original) Object.defineProperty(globalThis, 'localStorage', original)
		else Reflect.deleteProperty(globalThis, 'localStorage')
	}
}

test('previews eligible custom records without changing their local source', () => {
	const restoreStorage = useMemoryLocalStorage()
	try {
		const original = JSON.stringify({
			version: 2,
			baixas: [{
				id: 'local-baixa-1',
				transferId: 'repasse-1',
				beneficiary: 'Beneficiário local',
				paidAmount: 125,
				status: 'Pendente',
				description: '',
			}],
			history: [],
			emendas: [],
		})
		localStorage.setItem('fns-repasses-demo:v1', original)
		const snapshot = inspectLocalData()
		assert.equal(snapshot.categories.baixas, 1)
		assert.equal(localStorage.getItem('fns-repasses-demo:v1'), original)
		assert.deepEqual(snapshot.errors, [])
	} finally {
		restoreStorage()
	}
})

test('allows an explicitly confirmed backend migration without JWT and preserves local source records', async () => {
	const restoreStorage = useMemoryLocalStorage()
	const originalFetch = globalThis.fetch
	let requests = 0
	try {
		const original = '{"version":1,"launches":{}}'
		localStorage.setItem('fns-financial-launch-drafts:v1', original)
		globalThis.fetch = async () => {
			requests += 1
			return Response.json([])
		}
		const result = await migrateLocalData('', ['launches'])
		assert.deepEqual(result.errors, [])
		assert.equal(requests, 2)
		assert.equal(localStorage.getItem('fns-financial-launch-drafts:v1'), original)
	} finally {
		globalThis.fetch = originalFetch
		restoreStorage()
	}
})
