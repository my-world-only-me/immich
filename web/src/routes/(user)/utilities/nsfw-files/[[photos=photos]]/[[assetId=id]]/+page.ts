import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import { searchNsfwAssets } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const assets = await searchNsfwAssets({ minFileSize: 0 });
  const $t = await getFormatter();

  return {
    assets,
    meta: {
      title: $t('nsfw_files'),
    },
  };
}) satisfies PageLoad;
