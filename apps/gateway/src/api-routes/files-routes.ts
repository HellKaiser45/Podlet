import { Elysia, t } from 'elysia';
import AppContainer from '../runtime';
import { VirtualFileSystem } from '../system/sandbox';
import { FileUploadSchema } from '../types';

const vfsCache = new Map<string, VirtualFileSystem>();

function getVFS(rootDir: string, runId: string, cwd?: string): VirtualFileSystem {
  const key = `${runId}:${cwd ?? ''}`;
  let vfs = vfsCache.get(key);
  if (!vfs) {
    vfs = new VirtualFileSystem(rootDir, runId, cwd);
    if (vfsCache.size > 50) {
      const firstKey = vfsCache.keys().next().value;
      if (firstKey !== undefined) vfsCache.delete(firstKey);
    }
    vfsCache.set(key, vfs);
  }
  return vfs;
}

export default function filesRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/file' })
    .post('/upload', async function ({ body }) {
      const virtualManager = getVFS(container.initConfig.podeletDir, body.runId, body.cwd)

      const result = await virtualManager.upload(body)
      console.log('upload result: ', result)

      return result
    }, {
      body: FileUploadSchema,
    })
    .get('download-zip/:runid/:folderid', async function ({ params }) {
      const virtualPath = Buffer.from(params.folderid, 'base64url').toString();
      const virtualManager = getVFS(container.initConfig.podeletDir, params.runid);
      return virtualManager.streamFolderAsZip(virtualPath);
    })
    .get('download/:runid/:fileid', function ({ params }) {
      const virtualManager = getVFS(container.initConfig.podeletDir, params.runid)
      const bfile = virtualManager.getFile(params.fileid)

      return bfile
    })
    .get(':runid/:fileid', async function ({ params }) {
      const virtualManager = getVFS(container.initConfig.podeletDir, params.runid)
      return virtualManager.readFileText(params.fileid)
    })
    .get(
      '/all/:runid',
      async ({ params }) => {
        const vm = getVFS(container.initConfig.podeletDir, params.runid)
        const ws = await vm.listFiles('workspace://')
        const art = await vm.listFiles('artifacts://')
        return ws.concat(art)
      },
      {
        response: t.Array(
          t.Object({
            name: t.String(),
            vpath: t.String(),
            id: t.String(),
            type: t.UnionEnum(['text', 'image'])
          })
        )
      }
    )
    .delete('/:runid/:fileid', async function ({ params }) {
      const virtualManager = getVFS(container.initConfig.podeletDir, params.runid)
      return virtualManager.deleteFile(params.fileid)
    })
    .patch('/:runid/:fileid', async function ({ params, body }) {
      const virtualManager = getVFS(container.initConfig.podeletDir, params.runid);
      await virtualManager.updateFile(params.fileid, body);
      return { success: true };
    }, {
      body: t.String()
    })


}
