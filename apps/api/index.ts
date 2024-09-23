import 'dotenv/config'
import consola from 'consola'
import cors from 'cors'
import express from 'express'
import createHttpError from 'http-errors'
import morgan from 'morgan'
import { RedisClient } from './redis-client.js'
import { router as packagesRouter } from './routes/packages/index.js'
import { router as getPackageRouter } from './routes/packages/source/identifier/index.js'

interface Config {
  databaseUrl: string
  listenPort: number
  logLevel: number
}

interface ErrorResponse {
  apiVersion: '2.0.0'
  error: { code: number, message: string }
}

function createErrorResponse (
  code: number, message: string): ErrorResponse {
  return {
    apiVersion: '2.0.0',
    error: { code, message }
  }
}

async function main (): Promise<void> {
  const config: Config = {
    databaseUrl: process.env.DATABASE_URL ?? 'redis://localhost:6379',
    listenPort: Number(process.env.LISTEN_PORT ?? 80),
    logLevel: Number(process.env.LOG_LEVEL ?? 3)
  }

  consola.level = config.logLevel

  const redisClient = new RedisClient(config.databaseUrl)
  await redisClient.connect()

  const app = express()

  app.use(morgan('tiny'))
  app.use(cors())
  app.use(express.urlencoded({ extended: false }))
  app.use((req, _, next) => {
    req.app.locals.redisClient = redisClient

    next()
  })

  app.use('/packages/:source/:owner/:repo', (req, res, next) => {
    const { source, owner, repo } = req.params
    req.app.locals.source = source
    req.app.locals.identifier = `${owner}/${repo}`
    getPackageRouter(req, res, next)
  })
  app.use('/packages/:source/:identifier', (req, res, next) => {
    const { source, identifier } = req.params
    req.app.locals.source = source
    req.app.locals.identifier = identifier
    getPackageRouter(req, res, next)
  })
  app.use('/packages', packagesRouter)

  app.use(((err: Error, _, res, _next) => {
    if (createHttpError.isHttpError(err)) {
      res.status(err.statusCode)
        .send(createErrorResponse(err.statusCode, err.message))
    } else {
      consola.error(`Unhandled error: ${err.message}`)

      res.status(500).send(
        createErrorResponse(500, 'internal server error'))
    }
  }) as express.ErrorRequestHandler)

  app.use((_, res) => {
    res.status(403).send({
      code: 403,
      message: 'forbidden'
    })
  })

  app.listen(config.listenPort, () => {
    consola.success(`Server is running on port ${config.listenPort}`)
  })
}

main().catch((error) => {
  consola.error('Unhandled error:', error)
  process.exit(1)
})
