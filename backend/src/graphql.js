const path = require('path')
const fs = require('fs')
const graphqlHTTP = require('express-graphql')
const DataLoader = require('dataloader')
const { buildSchema } = require('graphql')
const { Server, Channel } = require('./db')
const { checkAuth, getPermissions } = require('./auth')

const schema = buildSchema(fs.readFileSync(path.join(__dirname, 'schema.gqls'), 'utf8'))

function initLoaders (user) {
  const channelLoader = new DataLoader(async (ids) => {
    const channels = await Channel.findAll({ where: { id: ids } })
    return ids.map(id => channels.find(s => s.id === id) || null)
  })

  function loadServerChannels (server) {
    if (server === undefined) {
      return null
    }

    server.channels = async () => {
      const permissions = await getPermissions(user, server.id)
      const ids = Object.keys(permissions).filter(id => permissions[id].has('readMessages'))

      return channelLoader.loadMany(ids)
    }

    return server
  }

  return {
    servers: new DataLoader(async (ids) => {
      const servers = await Server.findAll({ where: { active: true, id: ids } })
      return ids.map(id => loadServerChannels(servers.find(s => s.id === id)))
    }),
    channels: channelLoader
  }
}

const root = {
  identity (args, request) {
    const { id, username, discriminator } = request.user
    return { id, name: username, discriminator }
  },
  async servers (args, request) {
    return (await request.loaders.servers.loadMany(request.user.servers.map(server => server.id))).filter(s => s !== null)
  },
  server ({ id: requestedId }, request) {
    return request.user.servers.find(s => s.id === requestedId) ? request.loaders.servers.load(requestedId) : null
  }
}

module.exports = {
  init (app) {
    app.use((req, res, next) => {
      req.loaders = initLoaders(req.user)
      next()
    })
    app.use('/api/graphql', checkAuth, graphqlHTTP({
      schema,
      rootValue: root,
      graphiql: true
    }))
  }
}
