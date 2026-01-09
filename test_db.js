import path from 'node:path'

import fs from 'fs-extra'

import { DBStore, JSONStore } from './dist/index.js'

const TEST_DIR = './test_data'
const DB_PATH = path.join(TEST_DIR, 'test.db')
const JSON_PATH = path.join(TEST_DIR, 'test.json')

class SimpleTest {
  constructor() {
    this.tests = []
    this.passed = 0
    this.failed = 0
  }

  test(name, fn) {
    this.tests.push({ name, fn })
  }

  async run() {
    console.log('🚀 开始运行测试...\n')

    for (const { name, fn } of this.tests) {
      try {
        await fn()
        console.log(`✅ ${name}`)
        this.passed++
      } catch (error) {
        console.log(`❌ ${name}`)
        console.log(`   错误: ${error.message}`)
        this.failed++
      }
    }

    console.log(`\n📊 测试结果: ${this.passed} 通过, ${this.failed} 失败`)

    if (this.failed === 0) {
      console.log('🎉 所有测试通过!')
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || '断言失败')
  }
}

function assertEquals(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)}`)
  }
}

async function setupTest() {
  if (await fs.pathExists(TEST_DIR)) {
    await fs.remove(TEST_DIR)
  }
  await fs.ensureDir(TEST_DIR)
}

const test = new SimpleTest()

test.test('DBStore - 基本创建和初始化', async () => {
  const store = new DBStore(DB_PATH, 'users')
  assert(store, 'DBStore 应该被成功创建')

  const adapter = store.getAdapter()
  assert(adapter, '适配器应该存在')
})

test.test('DBStore - 读取空数据库', async () => {
  const store = new DBStore(DB_PATH, 'users')
  const data = await store.read()

  assert(data, '应该返回数据对象')
  assert(Array.isArray(data.users), 'users 应该是数组')
  assertEquals(data.users.length, 0, '初始数据应该为空')
})

test.test('DBStore - 插入单个数据', async () => {
  const store = new DBStore(DB_PATH, 'users')

  const user = { name: 'Alice', age: 30 }
  const result = await store.insert(user)

  assert(result, '插入应该返回结果')
  assert(result.id, '应该生成ID')
  assertEquals(result.name, 'Alice', '名称应该匹配')
  assertEquals(result.age, 30, '年龄应该匹配')
})

test.test('DBStore - 插入多个数据', async () => {
  const store = new DBStore(DB_PATH, 'users')

  const users = [
    { name: 'Bob', age: 25 },
    { name: 'Charlie', age: 35 },
  ]
  const result = await store.insertMany(users)

  assert(Array.isArray(result), '批量插入应该返回数组')
  assertEquals(result.length, 2, '应该插入2条数据')
})

test.test('DBStore - 查询数据', async () => {
  const store = new DBStore(DB_PATH, 'users')

  await store.insert([
    { name: 'David', age: 28 },
    { name: 'Eve', age: 32 },
  ])

  const result = await store.get()
  assert(result.total >= 2, '应该有至少2条数据')
  assert(Array.isArray(result.data), '数据应该是数组')
})

test.test('DBStore - 按ID查询', async () => {
  const store = new DBStore(DB_PATH, 'users')

  const insertResult = await store.insert({ name: 'Frank', age: 40 })
  const userId = insertResult.id

  const user = await store.getById(userId)
  assert(user, '应该找到用户')
  assertEquals(user.name, 'Frank', '名称应该匹配')
})

test.test('DBStore - 更新数据', async () => {
  const store = new DBStore(DB_PATH, 'users')

  const insertResult = await store.insert({ name: 'Grace', age: 26 })
  const userId = insertResult.id

  const updateResult = await store.updateById(userId, { age: 27 })
  assert(updateResult === true, '更新应该成功')

  const user = await store.getById(userId)
  assertEquals(user.age, 27, '年龄应该被更新')
})

test.test('DBStore - 删除数据', async () => {
  const store = new DBStore(DB_PATH, 'users')

  const insertResult = await store.insert({ name: 'Henry', age: 33 })
  const userId = insertResult.id

  await store.removeById(userId)

  const user = await store.getById(userId)
  assert(!user, '用户应该被删除')
})

test.test('JSONStore - 基本创建和初始化', async () => {
  const store = new JSONStore(JSON_PATH)
  assert(store, 'JSONStore 应该被成功创建')
})

test.test('JSONStore - 读取空数据', async () => {
  const store = new JSONStore(JSON_PATH)
  const data = store.read()

  assert(typeof data === 'object', '应该返回对象')
})

test.test('JSONStore - 设置和获取数据', async () => {
  const store = new JSONStore(JSON_PATH)

  store.set('user.name', 'John')
  store.set('user.age', 25)

  assertEquals(store.get('user.name'), 'John', '名称应该匹配')
  assertEquals(store.get('user.age'), 25, '年龄应该匹配')
})

test.test('JSONStore - 检查键是否存在', async () => {
  const store = new JSONStore(JSON_PATH)

  store.set('config.theme', 'dark')

  assert(store.has('config.theme'), '键应该存在')
  assert(!store.has('config.language'), '不存在的键应该返回false')
})

test.test('JSONStore - 删除数据', async () => {
  const store = new JSONStore(JSON_PATH)

  store.set('temp.data', 'test')
  assert(store.has('temp.data'), '数据应该存在')

  store.unset('temp', 'data')
  assert(!store.has('temp.data'), '数据应该被删除')
  assertEquals(store.get('temp.data'), undefined, '删除后数据应该为undefined')

  store.set('temp.data.details', { info: 'test info' })
  assert(store.has('temp.data.details'), '嵌套数据应该存在')
  store.unset('temp.data.details') // 删除嵌套数据
  assert(!store.has('temp.data.details'), '嵌套数据应该被删除')

  store.unset('temp') // 删除整个键
  assert(!store.has('temp'), '整个键应该被删除')
  assertEquals(store.get('temp'), undefined, '删除后整个键应该为undefined')
})

test.test('JSONStore - 嵌套对象操作', async () => {
  const store = new JSONStore(JSON_PATH)

  store.set('app.settings.notifications', true)
  store.set('app.settings.theme', 'light')

  assertEquals(store.get('app.settings.notifications'), true, '通知设置应该为true')
  assertEquals(store.get('app.settings.theme'), 'light', '主题应该为light')

  const settings = store.get('app.settings')
  assert(typeof settings === 'object', '设置应该是对象')
})

test.test('JSONStore - 清空数据库', async () => {
  const store = new JSONStore(JSON_PATH)
  store.clear()
  assertEquals(store.get('user'), undefined, '清空后数据应该为undefined')
  assertEquals(store.get('app.settings'), undefined, '清空后设置应该为undefined')
  assertEquals(store.get('temp'), undefined, '清空后临时数据应该为undefined')
})

async function runTests() {
  try {
    await setupTest()
    await test.run()
  } catch (error) {
    console.error('测试运行失败:', error)
  }
}

runTests().catch(console.error)
