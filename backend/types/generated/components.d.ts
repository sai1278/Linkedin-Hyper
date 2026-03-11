import type { Schema, Struct } from '@strapi/strapi';

export interface SharedCategoryDetails extends Struct.ComponentSchema {
  collectionName: 'components_shared_category_details';
  info: {
    description: 'Detail point for a category';
    displayName: 'Category Details';
    icon: 'bulletList';
  };
  attributes: {
    detail: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

export interface SharedPillarDetails extends Struct.ComponentSchema {
  collectionName: 'components_shared_pillar_details';
  info: {
    description: 'Detail point for a pillar';
    displayName: 'Pillar Details';
    icon: 'bulletList';
  };
  attributes: {
    detail: Schema.Attribute.Text & Schema.Attribute.Required;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: 'SEO metadata for content';
    displayName: 'SEO';
    icon: 'search';
  };
  attributes: {
    canonicalURL: Schema.Attribute.String;
    keywords: Schema.Attribute.Text;
    metaDescription: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 160;
      }>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 60;
      }>;
    noIndex: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    ogImage: Schema.Attribute.Media<'images'>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.category-details': SharedCategoryDetails;
      'shared.pillar-details': SharedPillarDetails;
      'shared.seo': SharedSeo;
    }
  }
}
