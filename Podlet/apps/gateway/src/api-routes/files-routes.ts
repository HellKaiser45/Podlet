import { Elysia, t } from 'elysia';
import AppContainer from '../runtime';
import { VirtualFileSystem } from '../system/sandbox';
import { FileUploadSchema } from '../types';



export default function filesRoutes(container: AppContainer) {
  return new Elysia({ prefix: '/file' })
    .post('/upload', async function ({ body }) {
      const virtualManager = new VirtualFileSystem(container.initConfig.podeletDir, body.runId, body.cwd)

      const result = await virtualManager.upload(body)
      console.log('upload result: ', result)

      return result
    }, {
      body: FileUploadSchema,
    })
    .get('download-zip/:runid/:folderid', async function ({ params }) {
      const virtualPath = Buffer.from(params.folderid, 'base64url').toString();
      const virtualManager = new VirtualFileSystem(container.initConfig.podeletDir, params.runid);
      return virtualManager.streamFolderAsZip(virtualPath);
    })
    .get('download/:runid/:fileid', function ({ params }) {
      const virtualManager = new VirtualFileSystem(container.initConfig.podeletDir, params.runid)
      const bfile = virtualManager.getFile(params.fileid)

      return bfile
    })
    .get(':runid/:fileid', async function ({ params }) {
      const virtualManager = new VirtualFileSystem(container.initConfig.podeletDir, params.runid)
      return virtualManager.readFileText(params.fileid)
    })
    .get(
      '/all/:runid',
      async ({ params }) => {
        const vm = new VirtualFileSystem(container.initConfig.podeletDir, params.runid)
        const ws = await vm.listFiles('/home/hellkaiser/.podlet/workspace/858d132d-4d20-47be-8c99-8cf8de52e1db/')
        const art = await vm.listFiles('/home/hellkaiser/.podlet/artifacts/858d132d-4d20-47be-8c99-8cf8de52e1db/')
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
      const virtualManager = new VirtualFileSystem(container.initConfig.podeletDir, params.runid)
      return virtualManager.deleteFile(params.fileid)
    })
    .patch('/:runid/:fileid', async function ({ params, body }) {
      const virtualManager = new VirtualFileSystem(container.initConfig.podeletDir, params.runid);
      await virtualManager.updateFile(params.fileid, body);
      return { success: true };
    }, {
      body: t.String()
    })


}
