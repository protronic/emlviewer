import {
  type ApplicationInformation,
  AppWrapperRoute,
  defineWebApplication,
  useClientService,
} from '@opencloud-eu/web-pkg';
import {useGettext} from 'vue3-gettext';
import App from './App.vue';
import {ocContext} from './ocContext';

const appId = 'emlviewer';

export default defineWebApplication({
  setup() {
    const {$gettext} = useGettext();
    const routeName = 'emlviewer-file';

    try {
      // "Save to OpenCloud" stores an attachment next to the opened .eml.
      // overwrite:false makes the PUT fail instead of clobbering a file
      // that already carries the attachment's name.
      const clientService = useClientService();
      ocContext.saveSibling = async (space, path, content) => {
        await clientService.webdav.putFileContents(space, {path, content, overwrite: false});
      };
    } catch {
      ocContext.saveSibling = undefined;
    }

    const routes = [
      {
        path: '/:driveAliasAndItem(.*)?',
        name: routeName,
        component: AppWrapperRoute(App, {
          applicationId: appId,
          fileContentOptions: {
            // Raw bytes: the MIME parser decodes the message's own charsets
            // (8bit latin1 bodies would be mangled by a text response).
            responseType: 'arraybuffer',
          },
        }),
        meta: {
          authContext: 'hybrid',
          title: $gettext('Eml Viewer'),
          patchCleanPath: true,
        },
      },
    ];

    const appInfo: ApplicationInformation = {
      id: appId,
      name: $gettext('Eml Viewer'),
      icon: 'mail',
      color: '#b5473c',
      extensions: [
        {
          extension: 'eml',
          mimeType: 'message/rfc822',
          routeName,
          label: () => $gettext('Open with Eml Viewer'),
          hasPriority: true,
        },
      ],
    };

    return {
      appInfo,
      routes,
    };
  },
});
