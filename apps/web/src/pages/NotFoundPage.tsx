import { Anchor, Stack, Title } from '@mantine/core';
import { Link } from 'react-router';
import { pl } from '../i18n/pl';
import { defaultPath } from '../navigation';

export function NotFoundPage() {
  return (
    <Stack gap="xs">
      <Title order={2}>{pl.pages.notFound.title}</Title>
      <Anchor component={Link} to={defaultPath}>
        {pl.pages.notFound.back}
      </Anchor>
    </Stack>
  );
}
